import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

const COLUMNS = [
  { id: "BACKLOG", label: "Backlog", color: "#64748b", bg: "#f1f5f9" },
  { id: "IN_PROGRESS", label: "In Progress", color: "#2563eb", bg: "#eff6ff" },
  { id: "IN_REVIEW", label: "In Review", color: "#d97706", bg: "#fffbeb" },
  { id: "DONE", label: "Completed", color: "#16a34a", bg: "#f0fdf4" }
];

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("devpulse_user") || "null"));
  const [isRegistering, setIsRegistering] = useState(false);
  
  // Auth Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("Member");

  // App & Task State
  const [usersList, setUsersList] = useState([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [tasks, setTasks] = useState([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("MEDIUM");
  const [aiPrompt, setAiPrompt] = useState("");
  const [loadingAi, setLoadingAi] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (err) {
      console.error("Connection error:", err);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users`);
      if (res.ok) {
        const data = await res.json();
        setUsersList(data);
        if (data.length > 0 && !assignedTo) {
          setAssignedTo(data[0].userId);
        }
      }
    } catch (err) {
      console.error("Error fetching users:", err);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchTasks();
    fetchUsers();

    const socket = new WebSocket(WS_URL);
    socket.onopen = () => setWsConnected(true);
    socket.onclose = () => setWsConnected(false);
    socket.onmessage = (event) => {
      if (event.data === "tasks_updated") fetchTasks();
    };

    return () => socket.close();
  }, [user]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.detail || "Login failed.");
        return;
      }
      setUser(data);
      localStorage.setItem("devpulse_user", JSON.stringify(data));
    } catch (err) {
      alert("Backend server offline.");
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.detail || "Registration failed.");
        return;
      }
      setUser(data);
      localStorage.setItem("devpulse_user", JSON.stringify(data));
    } catch (err) {
      alert("Backend server offline.");
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("devpulse_user");
  };

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    const res = await fetch(`${API_BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        title: taskTitle, 
        priority: taskPriority, 
        userId: user.userId,
        assignedTo: assignedTo || user.userId
      }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail);
      return;
    }
    setTaskTitle("");
    fetchTasks();
  };

  const handleAiBreakdown = async (e) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setLoadingAi(true);
    const res = await fetch(`${API_BASE}/api/tasks/ai-breakdown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        prompt: aiPrompt, 
        userId: user.userId,
        assignedTo: assignedTo || user.userId 
      }),
    });
    setLoadingAi(false);
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail);
      return;
    }
    setAiPrompt("");
    fetchTasks();
  };

  const handleUpdateStatus = async (id, newStatus) => {
    await fetch(`${API_BASE}/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    fetchTasks();
  };

  const handleDeleteTask = async (id) => {
    const res = await fetch(`${API_BASE}/api/tasks/${id}?userId=${user.userId}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(err.detail);
      return;
    }
    fetchTasks();
  };

  const isManager = user?.role === "Manager";

  if (!user) {
    return (
      <div style={styles.loginContainer}>
        <div style={styles.loginCard}>
          <div style={styles.logoBadge}>⚡ DevPulse Workspace</div>
          <h2 style={{ margin: '10px 0 5px', color: '#0f172a' }}>
            {isRegistering ? "Create Account" : "Sign In"}
          </h2>
          <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '20px' }}>
            {isRegistering ? "Enter details to create an account" : "Enter email and password to continue"}
          </p>

          <form onSubmit={isRegistering ? handleRegister : handleLogin}>
            {isRegistering && (
              <>
                <input
                  type="text"
                  placeholder="Full Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={styles.input}
                  required
                />
                <select 
                  value={role} 
                  onChange={(e) => setRole(e.target.value)}
                  style={styles.selectInput}
                >
                  <option value="Member">Member (Developer / Staff)</option>
                  <option value="Manager">Manager (Full Access)</option>
                </select>
              </>
            )}

            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              required
            />

            <button type="submit" style={styles.loginBtn}>
              {isRegistering ? "Register Account →" : "Sign In →"}
            </button>
          </form>

          <button 
            onClick={() => setIsRegistering(!isRegistering)} 
            style={styles.toggleBtn}
          >
            {isRegistering ? "Already have an account? Sign In" : "Need an account? Sign Up"}
          </button>

          {!isRegistering && (
            <div style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid #e2e8f0' }}>
              <p style={{ fontSize: '12px', color: '#94a3b8', margin: '0 0 8px' }}>Demo Credentials:</p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button 
                  onClick={() => { setEmail("manager@devpulse.com"); setPassword("admin123"); }} 
                  style={styles.demoChipManager}
                >
                  Manager Demo
                </button>
                <button 
                  onClick={() => { setEmail("member@devpulse.com"); setPassword("user123"); }} 
                  style={styles.demoChipMember}
                >
                  Member Demo
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.appShell}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}><span style={styles.brandIcon}>⚡</span> DevPulse</div>
        <nav style={{ flex: 1, marginTop: '20px' }}>
          <div style={styles.navItemActive}>📋 Kanban Board</div>
          <div style={styles.navItem}>📊 Analytics</div>
          <div style={styles.navItem}>⚙️ Settings</div>
        </nav>
        <div style={styles.userProfile}>
          <div style={styles.avatar}>{user.name ? user.name[0] : 'U'}</div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userRole}>{user.role} ({user.userId})</div>
          </div>
          <button onClick={handleLogout} style={styles.logoutBtn} title="Logout">🚪</button>
        </div>
      </aside>

      <main style={styles.mainContent}>
        <header style={styles.header}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', color: '#0f172a' }}>
              Workspace ({user.role} View)
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
              Logged in as: {user.email}
            </p>
          </div>
          <span style={wsConnected ? styles.statusLive : styles.statusOffline}>
            {wsConnected ? "🟢 Live Sync" : "🔴 Offline"}
          </span>
        </header>

        {isManager ? (
          <section style={styles.controlPanel}>
            {/* AI Generator Form */}
            <form onSubmit={handleAiBreakdown} style={styles.aiForm}>
              <input
                type="text"
                placeholder="✨ AI Generator: Enter goal to auto-create subtasks..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                style={styles.aiInput}
              />
              <button type="submit" disabled={loadingAi} style={styles.aiBtn}>
                {loadingAi ? "Generating..." : "⚡ Assign AI Tasks"}
              </button>
            </form>

            {/* Manual Task Assignment Form */}
            <form onSubmit={handleAddTask} style={styles.addForm}>
              <input
                type="text"
                placeholder="+ Add manual task..."
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                style={styles.taskInput}
              />
              
              {/* Select Assignee Dropdown */}
              <select 
                value={assignedTo} 
                onChange={(e) => setAssignedTo(e.target.value)} 
                style={styles.selectInputInline}
              >
                {usersList.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    👤 Assign to: {u.name} ({u.role})
                  </option>
                ))}
              </select>

              {/* Priority Dropdown */}
              <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)} style={styles.prioritySelect}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
              </select>

              <button type="submit" style={styles.addBtn}>Assign Task</button>
            </form>
          </section>
        ) : (
          <div style={styles.memberNotice}>
            🔒 <strong>Team Member Mode:</strong> You can view tasks and update their status. Task creation and member assignment are restricted to Managers.
          </div>
        )}

        {/* 4-Column Kanban Board */}
        <div style={styles.kanbanGrid}>
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.id);
            return (
              <div key={col.id} style={{ ...styles.column, backgroundColor: col.bg }}>
                <div style={styles.columnHeader}>
                  <span style={styles.colTitle}>{col.label}</span>
                  <span style={styles.badge}>{colTasks.length}</span>
                </div>

                <div style={styles.cardContainer}>
                  {colTasks.map((task) => (
                    <div key={task.id} style={styles.card}>
                      <div style={styles.cardHeader}>
                        <span style={getPriorityStyle(task.priority)}>{task.priority}</span>
                        <span style={styles.cardUser}>👤 {task.assignedTo}</span>
                      </div>
                      <p style={styles.cardTitle}>{task.title}</p>
                      
                      <div style={styles.cardFooter}>
                        <select
                          value={task.status}
                          onChange={(e) => handleUpdateStatus(task.id, e.target.value)}
                          style={styles.statusSelect}
                        >
                          {COLUMNS.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>

                        {isManager && (
                          <button onClick={() => handleDeleteTask(task.id)} style={styles.deleteBtn} title="Delete Task">
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function getPriorityStyle(p) {
  const base = { fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px' };
  if (p === 'HIGH') return { ...base, backgroundColor: '#fef2f2', color: '#ef4444' };
  if (p === 'MEDIUM') return { ...base, backgroundColor: '#fffbe8', color: '#d97706' };
  return { ...base, backgroundColor: '#f0fdf4', color: '#16a34a' };
}

const styles = {
  loginContainer: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a', fontFamily: 'Inter, sans-serif' },
  loginCard: { backgroundColor: '#ffffff', width: '380px', padding: '35px', borderRadius: '16px', textAlign: 'center' },
  logoBadge: { display: 'inline-block', backgroundColor: '#eff6ff', color: '#2563eb', padding: '6px 14px', borderRadius: '20px', fontWeight: 'bold', fontSize: '13px' },
  input: { width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box' },
  selectInput: { width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box', backgroundColor: 'white' },
  selectInputInline: { padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', backgroundColor: 'white' },
  loginBtn: { width: '100%', padding: '12px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginTop: '5px' },
  toggleBtn: { background: 'none', border: 'none', color: '#2563eb', fontSize: '13px', cursor: 'pointer', marginTop: '15px' },
  demoChipManager: { background: '#fef3c7', border: '1px solid #f59e0b', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#b45309', fontWeight: 'bold' },
  demoChipMember: { background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#334155' },

  appShell: { display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#f8fafc', fontFamily: 'Inter, sans-serif' },
  sidebar: { width: '250px', backgroundColor: '#0f172a', color: 'white', display: 'flex', flexDirection: 'column', padding: '20px' },
  brand: { fontSize: '20px', fontWeight: 'bold', color: '#f8fafc' },
  brandIcon: { color: '#38bdf8' },
  navItemActive: { padding: '10px 14px', backgroundColor: '#1e293b', color: '#38bdf8', borderRadius: '8px', fontWeight: 'bold', marginBottom: '8px' },
  navItem: { padding: '10px 14px', color: '#94a3b8', borderRadius: '8px', marginBottom: '8px' },
  userProfile: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', backgroundColor: '#1e293b', borderRadius: '10px' },
  avatar: { width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#2563eb', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold' },
  userName: { fontSize: '13px', fontWeight: 'bold', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  userRole: { fontSize: '11px', color: '#94a3b8' },
  logoutBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' },

  mainContent: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { height: '65px', borderBottom: '1px solid #e2e8f0', backgroundColor: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 30px' },
  statusLive: { fontSize: '12px', color: '#16a34a', fontWeight: 'bold', backgroundColor: '#f0fdf4', padding: '4px 10px', borderRadius: '12px' },
  statusOffline: { fontSize: '12px', color: '#ef4444', fontWeight: 'bold', backgroundColor: '#fef2f2', padding: '4px 10px', borderRadius: '12px' },

  controlPanel: { padding: '20px 30px 10px', display: 'flex', flexDirection: 'column', gap: '12px' },
  aiForm: { display: 'flex', gap: '10px' },
  aiInput: { flex: 1, padding: '12px 16px', border: '2px solid #a855f7', borderRadius: '8px', fontSize: '14px' },
  aiBtn: { padding: '0 20px', backgroundColor: '#a855f7', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  addForm: { display: 'flex', gap: '10px' },
  taskInput: { flex: 1, padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px' },
  prioritySelect: { padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', backgroundColor: 'white' },
  addBtn: { padding: '0 20px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  memberNotice: { margin: '20px 30px 10px', padding: '12px 16px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', color: '#475569' },

  kanbanGrid: { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', padding: '10px 30px 20px', overflowY: 'auto' },
  column: { borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column' },
  columnHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' },
  colTitle: { fontWeight: 'bold', fontSize: '14px', color: '#1e293b' },
  badge: { backgroundColor: '#ffffff', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold', color: '#64748b' },
  cardContainer: { flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' },
  card: { backgroundColor: 'white', padding: '14px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  cardUser: { fontSize: '11px', color: '#64748b', fontWeight: 'bold' },
  cardTitle: { margin: '0 0 12px', fontSize: '14px', color: '#1e293b', lineHeight: '1.4' },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  statusSelect: { fontSize: '12px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }
};