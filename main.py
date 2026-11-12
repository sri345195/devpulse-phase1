import sqlite3
import os
import json
import hashlib
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Literal, Optional
from openai import OpenAI

app = FastAPI()
DATABASE_PATH = os.path.abspath(
    os.getenv("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "tasks.db"))
)

def connect_db():
    os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
    return sqlite3.connect(DATABASE_PATH)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

openai_api_key = os.getenv("OPENAI_API_KEY", "")
client = OpenAI(api_key=openai_api_key) if openai_api_key else None

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception:
                pass

manager = ConnectionManager()

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def init_db():
    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT DEFAULT 'Member'
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'BACKLOG',
            priority TEXT DEFAULT 'MEDIUM',
            user_id TEXT,
            assigned_to TEXT,
            FOREIGN KEY (user_id) REFERENCES users (user_id),
            FOREIGN KEY (assigned_to) REFERENCES users (user_id)
        )
    """)
    # Default Demo Users
    mgr_pwd = hash_password("admin123")
    dev_pwd = hash_password("user123")
    cursor.execute("INSERT OR IGNORE INTO users (user_id, email, password, name, role) VALUES ('MGR-101', 'manager@devpulse.com', ?, 'Alex Mercer', 'Manager')", (mgr_pwd,))
    cursor.execute("INSERT OR IGNORE INTO users (user_id, email, password, name, role) VALUES ('DEV-102', 'member@devpulse.com', ?, 'Sarah Chen', 'Member')", (dev_pwd,))
    cursor.execute("INSERT OR IGNORE INTO users (user_id, email, password, name, role) VALUES ('DEV-103', 'john@devpulse.com', ?, 'John Doe', 'Member')", (dev_pwd,))
    conn.commit()
    conn.close()

init_db()

def get_user_role(user_id: str) -> str:
    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("SELECT role FROM users WHERE user_id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=403, detail="Permission denied: User not found.")
    return row[0]

def check_is_manager(user_id: str):
    if get_user_role(user_id) != "Manager":
        raise HTTPException(status_code=403, detail="Permission denied: Only Managers can assign or delete tasks.")

class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str = "Member"

class TaskCreate(BaseModel):
    title: str
    priority: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"
    userId: str         # Creator (Manager)
    assignedTo: str     # Assignee (Team Member)

class TaskUpdate(BaseModel):
    status: Optional[Literal["BACKLOG", "IN_PROGRESS", "IN_REVIEW", "DONE"]] = None
    priority: Optional[Literal["LOW", "MEDIUM", "HIGH"]] = None
    assignedTo: Optional[str] = None
    userId: Optional[str] = None

class AIBreakdownRequest(BaseModel):
    prompt: str
    userId: str

@app.get("/api/users")
def get_users():
    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("SELECT user_id, name, role, email FROM users")
    rows = cursor.fetchall()
    conn.close()
    return [{"userId": r[0], "name": r[1], "role": r[2], "email": r[3]} for r in rows]

@app.post("/api/auth/register")
def register(req: RegisterRequest):
    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("SELECT email FROM users WHERE email = ?", (req.email.strip().lower(),))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Email is already registered.")
    
    user_id = f"USER-{hashlib.md5(req.email.encode()).hexdigest()[:6].upper()}"
    hashed_pwd = hash_password(req.password)
    
    cursor.execute(
        "INSERT INTO users (user_id, email, password, name, role) VALUES (?, ?, ?, ?, ?)",
        (user_id, req.email.strip().lower(), hashed_pwd, req.name.strip(), req.role)
    )
    conn.commit()
    conn.close()
    return {"userId": user_id, "email": req.email, "name": req.name, "role": req.role}

@app.post("/api/auth/login")
def login(req: LoginRequest):
    conn = connect_db()
    cursor = conn.cursor()
    hashed_pwd = hash_password(req.password)
    
    cursor.execute("SELECT user_id, name, role, email FROM users WHERE email = ? AND password = ?", 
                   (req.email.strip().lower(), hashed_pwd))
    user = cursor.fetchone()
    conn.close()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
        
    return {"userId": user[0], "name": user[1], "role": user[2], "email": user[3]}

@app.get("/api/tasks")
def get_tasks():
    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT t.id, t.title, t.status, t.priority, t.user_id, t.assigned_to,
               COALESCE(u.name, t.assigned_to)
        FROM tasks t
        LEFT JOIN users u ON t.assigned_to = u.user_id
    """)
    rows = cursor.fetchall()
    conn.close()
    return [{
        "id": r[0], 
        "title": r[1], 
        "status": r[2], 
        "priority": r[3], 
        "userId": r[4], 
        "assignedToId": r[5],
        "assignedTo": r[6] or "Unassigned"
    } for r in rows]

@app.post("/api/tasks")
async def create_task(task: TaskCreate):
    check_is_manager(task.userId)
    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO tasks (title, status, priority, user_id, assigned_to) VALUES (?, 'BACKLOG', ?, ?, ?)", 
                   (task.title, task.priority, task.userId, task.assignedTo))
    conn.commit()
    task_id = cursor.lastrowid
    conn.close()
    await manager.broadcast("tasks_updated")
    return {"id": task_id, "title": task.title, "status": "BACKLOG", "priority": task.priority, "userId": task.userId, "assignedTo": task.assignedTo}

@app.put("/api/tasks/{task_id}")
async def update_task(task_id: int, task: TaskUpdate):
    updates = []
    if task.status is not None:
        updates.append(("status", task.status))
    if task.priority is not None:
        updates.append(("priority", task.priority))
    if task.assignedTo is not None:
        updates.append(("assigned_to", task.assignedTo))
    if not updates:
        raise HTTPException(status_code=400, detail="At least one task field must be provided.")

    if not task.userId:
        raise HTTPException(status_code=400, detail="UserId is required to update a task.")
    actor_role = get_user_role(task.userId)
    if (task.priority is not None or task.assignedTo is not None) and actor_role != "Manager":
        raise HTTPException(status_code=403, detail="Only Managers can change task priority or assignee.")

    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("SELECT assigned_to FROM tasks WHERE id = ?", (task_id,))
    task_row = cursor.fetchone()
    if not task_row:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found.")
    if task.status is not None and actor_role != "Manager" and task_row[0] != task.userId:
        conn.close()
        raise HTTPException(status_code=403, detail="You can update the status only of tasks assigned to you.")

    if task.assignedTo is not None:
        cursor.execute("SELECT user_id FROM users WHERE user_id = ?", (task.assignedTo,))
        if not cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=400, detail="Selected assignee does not exist.")

    set_clause = ", ".join(f"{column} = ?" for column, _ in updates)
    cursor.execute(
        f"UPDATE tasks SET {set_clause} WHERE id = ?",
        [value for _, value in updates] + [task_id]
    )
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found.")
    conn.commit()
    conn.close()
    await manager.broadcast("tasks_updated")
    return {
        "id": task_id,
        "status": task.status,
        "priority": task.priority,
        "assignedTo": task.assignedTo
    }

@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, userId: str):
    check_is_manager(userId)
    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    await manager.broadcast("tasks_updated")
    return {"message": "Task deleted"}

@app.post("/api/tasks/ai-breakdown")
async def ai_breakdown(req: AIBreakdownRequest):
    check_is_manager(req.userId)
    subtasks = []
    
    if client:
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a project manager. Return JSON with key 'tasks' containing 3-4 concise actionable steps."},
                    {"role": "user", "content": req.prompt}
                ],
                response_format={"type": "json_object"}
            )
            data = json.loads(response.choices[0].message.content)
            subtasks = data.get("tasks", [])
        except Exception:
            subtasks = []

    if not subtasks:
        subtasks = [
            f"Requirements analysis for: {req.prompt}",
            f"Database model design for: {req.prompt}",
            f"API integration for: {req.prompt}",
            f"Frontend UI implementation for: {req.prompt}"
        ]

    conn = connect_db()
    cursor = conn.cursor()
    cursor.execute("SELECT user_id FROM users WHERE role != 'Manager' ORDER BY user_id")
    assignees = [row[0] for row in cursor.fetchall()]
    if not assignees:
        assignees = [req.userId]

    for index, title in enumerate(subtasks):
        cursor.execute("INSERT INTO tasks (title, status, priority, user_id, assigned_to) VALUES (?, 'BACKLOG', 'HIGH', ?, ?)", 
                       (title, req.userId, assignees[index % len(assignees)]))
    conn.commit()
    conn.close()
    
    await manager.broadcast("tasks_updated")
    return {"message": "Tasks generated successfully", "tasks": subtasks}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)