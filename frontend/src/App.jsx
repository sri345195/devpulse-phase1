import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";

const COLUMNS = [
  { id: "BACKLOG", label: "Backlog", color: "#64748b", bg: "#f1f5f9" },
  { id: "IN_PROGRESS", label: "In Progress", color: "#2563eb", bg: "#eff6ff" },
  { id: "IN_REVIEW", label: "In Review", color: "#d97706", bg: "#fffbeb" },
  { id: "DONE", label: "Completed", color: "#16a34a", bg: "#f0fdf4" }
];

function getErrorMessage(detail, fallback) {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => (typeof item === "string" ? item : item?.msg || JSON.stringify(item)))
      .join("; ");
  }
  return fallback;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [activeTab, setActiveTab] = useState("kanban"); // "kanban" | "analytics" | "settings"

  // Auth Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("Member");

  // App & Task State
  const [usersList, setUsersList] = useState([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [tasks, setTasks] = useState([]);
  const [taskLoadError, setTaskLoadError] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("MEDIUM");
  const [aiPrompt, setAiPrompt] = useState("");
  const [loadingAi, setLoadingAi] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks`);
      if (!res.ok) {
        setTaskLoadError(`Unable to load tasks (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      setTasks(data);
      setTaskLoadError("");
    } catch (err) {
      console.error("Connection error:", err);
      setTaskLoadError("Unable to reach the backend to load tasks.");
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/users`);
      if (res.ok) {
        const data = await res.json();
        setUsersList(data);
        if (data.length > 0 && !assignedTo) {
          const firstMember = data.find((candidate) => candidate.role !== "Manager");
          setAssignedTo((firstMember || data[0]).userId);
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
        alert(getErrorMessage(data.detail, "Login failed."));
        return;
      }
      setUser(data);
    } catch (err) {
      alert("Backend server is waking up or offline. Please wait 30 seconds and try again.");
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
        alert(getErrorMessage(data.detail, "Registration failed."));
        return;
      }
      setUser(data);
    } catch (err) {
      alert("Backend server offline.");
    }
  };

  const handleLogout = () => {
    setUser(null);
    setActiveTab("kanban");
    setAssignedTo("");
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
      alert(getErrorMessage(err.detail, "Unable to assign task."));
      return;
    }
    setTaskTitle("");
    fetchTasks();
  };

  const handleAiBreakdown = async (e) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setLoadingAi(true);
    try {
      const res = await fetch(`${API_BASE}/api/tasks/ai-breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, userId: user.userId }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(getErrorMessage(err.detail, "Unable to assign AI tasks."));
        return;
      }
      setAiPrompt("");
      fetchTasks();
    } catch (err) {
      console.error("AI task assignment failed:", err);
      alert("Unable to reach the backend to assign AI tasks.");
    } finally {
      setLoadingAi(false);
    }
  };

  const handleUpdateTask = async (id, updates) => {
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...updates,
          userId: user.userId,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(getErrorMessage(err.detail, "Unable to update task."));
        return;
      }
      fetchTasks();
    } catch (err) {
      console.error("Task update failed:", err);
      alert("Unable to reach the backend to update this task.");
    }
  };

  const handleDeleteTask = async (id) => {
    const res = await fetch(`${API_BASE}/api/tasks/${id}?userId=${user.userId}`, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json();
      alert(getErrorMessage(err.detail, "Unable to delete task."));
      return;
    }
    fetchTasks();
  };

  const isManager = user?.role === "Manager";

  // LOGIN / REGISTER SCREEN
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
                  <option value="Member" style={styles.optionItem}>Member (Developer / Staff)</option>
                  <option value="Manager" style={styles.optionItem}>Manager (Full Access)</option>
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
                  type="button"
                  onClick={() => { setEmail("manager@devpulse.com"); setPassword("admin123"); }}
                  style={styles.demoChipManager}
                >
                  Manager Demo
                </button>
                <button
                  type="button"
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

  // Analytics Calculations
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "DONE").length;
  const highPriorityTasks = tasks.filter((t) => t.priority === "HIGH").length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div style={styles.appShell}>
      {/* Left Navigation Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.brand}><span style={styles.brandIcon}>⚡</span> DevPulse</div>
        <nav style={{ flex: 1, marginTop: '20px' }}>
          <button
            type="button"
            onClick={() => setActiveTab("kanban")}
            aria-current={activeTab === "kanban" ? "page" : undefined}
            style={activeTab === "kanban" ? styles.navItemActive : styles.navItem}
          >
            📋 Kanban Board
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("analytics")}
            aria-current={activeTab === "analytics" ? "page" : undefined}
            style={activeTab === "analytics" ? styles.navItemActive : styles.navItem}
          >
            📊 Analytics
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            aria-current={activeTab === "settings" ? "page" : undefined}
            style={activeTab === "settings" ? styles.navItemActive : styles.navItem}
          >
            ⚙️ Settings
          </button>
        </nav>

        <div style={styles.userProfile}>
          <div style={styles.avatar}>{user.name ? user.name[0] : 'U'}</div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userRole}>{user.role} ({user.userId})</div>
          </div>
          <button onClick={handleLogout} style={styles.logoutBtn} title="Sign Out" aria-label="Sign Out">
            🚪 <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={styles.mainContent}>
        <header style={styles.header}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', color: '#0f172a' }}>
              {activeTab === "kanban" && `Workspace (${user.role} View)`}
              {activeTab === "analytics" && "Sprint Analytics & Metrics"}
              {activeTab === "settings" && "Workspace Settings & Team"}
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
              Logged in as: {user.email}
            </p>
          </div>
          <span style={wsConnected ? styles.statusLive : styles.statusOffline}>
            {wsConnected ? "🟢 Live Sync" : "🔴 Offline"}
          </span>
        </header>

        {/* TAB 1: KANBAN BOARD */}
        {activeTab === "kanban" && (
          <>
            {isManager ? (
              <section style={styles.controlPanel}>
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

                <form onSubmit={handleAddTask} style={styles.addForm}>
                  <input
                    type="text"
                    placeholder="+ Add manual task..."
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    style={styles.taskInput}
                  />

                  <select
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    style={styles.selectInputInline}
                  >
                    {usersList.length === 0 && (
                      <option value="" disabled>No employees available</option>
                    )}
                    {usersList.map((u) => (
                      <option key={u.userId} value={u.userId} style={styles.optionItem}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>

                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value)}
                    style={styles.prioritySelect}
                  >
                    <option value="LOW" style={styles.optionItem}>Low</option>
                    <option value="MEDIUM" style={styles.optionItem}>Medium</option>
                    <option value="HIGH" style={styles.optionItem}>High</option>
                  </select>

                  <button type="submit" style={styles.addBtn}>Assign Task</button>
                </form>
              </section>
            ) : (
              <div style={styles.memberNotice}>
                🔒 <strong>Team Member Mode:</strong> You can view tasks and update their status. Task creation and member assignment are restricted to Managers.
              </div>
            )}

            {taskLoadError && <div role="alert" style={styles.taskLoadError}>{taskLoadError}</div>}
            {!taskLoadError && tasks.length === 0 && (
              <div style={styles.taskEmptyState}>No tasks are saved yet. Add a task or use AI to create tasks.</div>
            )}

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
                      {colTasks.map((task) => {
                        const taskAssigneeId = task.assignedToId || usersList.find((member) => member.name === task.assignedTo)?.userId;
                        const canChangeStatus = isManager || taskAssigneeId === user.userId;
                        return (
                        <div key={task.id} style={styles.card}>
                          <div style={styles.cardHeader}>
                            {isManager ? (
                              <>
                                <select
                                  aria-label={`Priority for ${task.title}`}
                                  value={task.priority}
                                  onChange={(e) => handleUpdateTask(task.id, { priority: e.target.value })}
                                  style={styles.cardPrioritySelect}
                                >
                                  <option value="LOW">Low</option>
                                  <option value="MEDIUM">Medium</option>
                                  <option value="HIGH">High</option>
                                </select>
                                <select
                                  aria-label={`Assignee for ${task.title}`}
                                  value={task.assignedToId || usersList.find((member) => member.name === task.assignedTo)?.userId || ""}
                                  onChange={(e) => handleUpdateTask(task.id, { assignedTo: e.target.value })}
                                  style={styles.cardAssigneeSelect}
                                  disabled={usersList.length === 0}
                                >
                                  {usersList.length === 0 && <option value="">No employees available</option>}
                                  {usersList.map((member) => (
                                    <option key={member.userId} value={member.userId}>{member.name}</option>
                                  ))}
                                </select>
                              </>
                            ) : (
                              <>
                                <span style={getPriorityStyle(task.priority)}>{task.priority}</span>
                                <span style={styles.cardUser}>👤 {task.assignedTo}</span>
                              </>
                            )}
                          </div>
                          <p style={styles.cardTitle}>{task.title}</p>

                          <div style={styles.cardFooter}>
                            <select
                              value={task.status}
                              onChange={(e) => handleUpdateTask(task.id, { status: e.target.value })}
                              style={styles.statusSelect}
                              disabled={!canChangeStatus}
                              title={canChangeStatus ? "Update task status" : "You can update only tasks assigned to you"}
                            >
                              {COLUMNS.map((c) => (
                                <option key={c.id} value={c.id} style={styles.optionItem}>{c.label}</option>
                              ))}
                            </select>

                            {isManager && (
                              <button onClick={() => handleDeleteTask(task.id)} style={styles.deleteBtn} title="Delete Task">
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* TAB 2: ANALYTICS VIEW */}
        {activeTab === "analytics" && (
          <div style={styles.pageContainer}>
            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Total Sprint Tasks</div>
                <div style={styles.statValue}>{totalTasks}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Completion Rate</div>
                <div style={{ ...styles.statValue, color: '#16a34a' }}>{completionRate}%</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>High Priority Tasks</div>
                <div style={{ ...styles.statValue, color: '#ef4444' }}>{highPriorityTasks}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Team Members</div>
                <div style={{ ...styles.statValue, color: '#2563eb' }}>{usersList.length}</div>
              </div>
            </div>

            <div style={styles.panelCard}>
              <h3 style={styles.panelTitle}>Task Distribution by Stage</h3>
              {COLUMNS.map((col) => {
                const count = tasks.filter((t) => t.status === col.id).length;
                const pct = totalTasks > 0 ? Math.round((count / totalTasks) * 100) : 0;
                return (
                  <div key={col.id} style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px', color: '#334155', fontWeight: '600' }}>
                      <span>{col.label}</span>
                      <span>{count} tasks ({pct}%)</span>
                    </div>
                    <div style={{ width: '100%', height: '10px', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', backgroundColor: col.color, transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={styles.panelCard}>
              <h3 style={styles.panelTitle}>Workload by Team Member</h3>
              {usersList.map((member) => {
                const memberTasks = tasks.filter((t) => t.assignedTo === member.name);
                const doneCount = memberTasks.filter((t) => t.status === "DONE").length;
                return (
                  <div key={member.userId} style={styles.listRow}>
                    <div>
                      <strong style={{ color: '#0f172a' }}>{member.name}</strong>
                      <span style={{ marginLeft: '8px', fontSize: '12px', color: '#64748b' }}>({member.role})</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#334155' }}>
                      Assigned: <strong>{memberTasks.length}</strong> • Completed: <strong style={{ color: '#16a34a' }}>{doneCount}</strong>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: SETTINGS VIEW */}
        {activeTab === "settings" && (
          <div style={styles.pageContainer}>
            <div style={styles.panelCard}>
              <h3 style={styles.panelTitle}>Account Profile</h3>
              <div style={styles.listRow}><span style={{ color: '#64748b' }}>Full Name</span><strong style={{ color: '#0f172a' }}>{user.name}</strong></div>
              <div style={styles.listRow}><span style={{ color: '#64748b' }}>Email Address</span><strong style={{ color: '#0f172a' }}>{user.email}</strong></div>
              <div style={styles.listRow}><span style={{ color: '#64748b' }}>User ID</span><strong style={{ color: '#0f172a' }}>{user.userId}</strong></div>
              <div style={styles.listRow}><span style={{ color: '#64748b' }}>Access Role</span><strong style={{ color: '#2563eb' }}>{user.role}</strong></div>
            </div>

            <div style={styles.panelCard}>
              <h3 style={styles.panelTitle}>Registered Workspace Team</h3>
              {usersList.map((u) => (
                <div key={u.userId} style={styles.listRow}>
                  <div>
                    <strong style={{ color: '#0f172a' }}>{u.name}</strong>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{u.email}</div>
                  </div>
                  <span style={u.role === "Manager" ? styles.roleBadgeManager : styles.roleBadgeMember}>
                    {u.role}
                  </span>
                </div>
              ))}
            </div>

            <div style={styles.panelCard}>
              <h3 style={styles.panelTitle}>Server & Sync Configuration</h3>
              <div style={styles.listRow}><span style={{ color: '#64748b' }}>Backend API Endpoint</span><code style={{ fontSize: '12px', color: '#0f172a' }}>{API_BASE}</code></div>
              <div style={styles.listRow}><span style={{ color: '#64748b' }}>WebSocket Status</span><strong style={{ color: wsConnected ? '#16a34a' : '#ef4444' }}>{wsConnected ? "Connected" : "Disconnected"}</strong></div>
              <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                <button onClick={() => { fetchTasks(); fetchUsers(); }} style={styles.addBtn}>
                  🔄 Sync Workspace Now
                </button>
                <button onClick={handleLogout} style={{ ...styles.addBtn, backgroundColor: '#ef4444' }}>
                  🚪 Sign Out
                </button>
              </div>
            </div>
          </div>
        )}
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
  input: { width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box', backgroundColor: '#ffffff', color: '#0f172a' },
  selectInput: { width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box', backgroundColor: '#ffffff', color: '#0f172a' },
  selectInputInline: { padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '500' },
  optionItem: { backgroundColor: '#ffffff', color: '#0f172a' },
  loginBtn: { width: '100%', padding: '12px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', marginTop: '5px' },
  toggleBtn: { background: 'none', border: 'none', color: '#2563eb', fontSize: '13px', cursor: 'pointer', marginTop: '15px' },
  demoChipManager: { background: '#fef3c7', border: '1px solid #f59e0b', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#b45309', fontWeight: 'bold' },
  demoChipMember: { background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 10px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#334155' },

  appShell: { display: 'flex', width: '100vw', height: '100vh', backgroundColor: '#f8fafc', fontFamily: 'Inter, sans-serif' },
  sidebar: { width: '250px', backgroundColor: '#0f172a', color: 'white', display: 'flex', flexDirection: 'column', padding: '20px' },
  brand: { fontSize: '20px', fontWeight: 'bold', color: '#f8fafc' },
  brandIcon: { color: '#38bdf8' },
  navItemActive: { width: '100%', padding: '10px 14px', backgroundColor: '#1e293b', color: '#38bdf8', border: 'none', borderRadius: '8px', font: 'inherit', textAlign: 'left', fontWeight: 'bold', marginBottom: '8px', cursor: 'pointer' },
  navItem: { width: '100%', padding: '10px 14px', backgroundColor: 'transparent', color: '#94a3b8', border: 'none', borderRadius: '8px', font: 'inherit', textAlign: 'left', marginBottom: '8px', cursor: 'pointer' },
  userProfile: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', backgroundColor: '#1e293b', borderRadius: '10px' },
  avatar: { width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#2563eb', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold' },
  userName: { fontSize: '13px', fontWeight: 'bold', color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  userRole: { fontSize: '11px', color: '#94a3b8' },
  logoutBtn: { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: '#f8fafc', whiteSpace: 'nowrap', cursor: 'pointer', fontSize: '11px', fontWeight: '600' },

  mainContent: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: { height: '65px', borderBottom: '1px solid #e2e8f0', backgroundColor: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 30px' },
  statusLive: { fontSize: '12px', color: '#16a34a', fontWeight: 'bold', backgroundColor: '#f0fdf4', padding: '4px 10px', borderRadius: '12px' },
  statusOffline: { fontSize: '12px', color: '#ef4444', fontWeight: 'bold', backgroundColor: '#fef2f2', padding: '4px 10px', borderRadius: '12px' },

  controlPanel: { padding: '20px 30px 10px', display: 'flex', flexDirection: 'column', gap: '12px' },
  aiForm: { display: 'flex', gap: '10px' },
  aiInput: { flex: 1, padding: '12px 16px', border: '2px solid #a855f7', borderRadius: '8px', fontSize: '14px', backgroundColor: '#ffffff', color: '#0f172a' },
  aiBtn: { padding: '0 20px', backgroundColor: '#a855f7', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  addForm: { display: 'flex', gap: '10px' },
  taskInput: { flex: 1, padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', backgroundColor: '#ffffff', color: '#0f172a' },
  prioritySelect: { padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', backgroundColor: '#ffffff', color: '#0f172a', fontWeight: '500' },
  addBtn: { padding: '10px 20px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' },
  memberNotice: { margin: '20px 30px 10px', padding: '12px 16px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', color: '#475569' },
  taskLoadError: { margin: '0 30px 10px', padding: '12px 16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c', fontSize: '13px' },
  taskEmptyState: { margin: '0 30px 10px', padding: '12px 16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#64748b', fontSize: '13px' },

  kanbanGrid: { flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', padding: '10px 30px 20px', overflowY: 'auto' },
  column: { borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column' },
  columnHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' },
  colTitle: { fontWeight: 'bold', fontSize: '14px', color: '#1e293b' },
  badge: { backgroundColor: '#ffffff', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold', color: '#64748b' },
  cardContainer: { flex: 1, display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' },
  card: { backgroundColor: 'white', padding: '14px', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0' },
  cardHeader: { display: 'flex', gap: '6px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  cardPrioritySelect: { flex: '0 0 76px', minWidth: 0, padding: '3px 4px', border: '1px solid #cbd5e1', borderRadius: '5px', fontSize: '10px', backgroundColor: '#ffffff', color: '#0f172a' },
  cardAssigneeSelect: { flex: '1 1 0', minWidth: 0, padding: '3px 4px', border: '1px solid #cbd5e1', borderRadius: '5px', fontSize: '10px', backgroundColor: '#ffffff', color: '#0f172a' },
  cardUser: { fontSize: '11px', color: '#64748b', fontWeight: 'bold' },
  cardTitle: { margin: '0 0 12px', fontSize: '14px', color: '#1e293b', lineHeight: '1.4' },
  cardFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  statusSelect: { fontSize: '12px', padding: '4px 6px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#0f172a' },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 },

  pageContainer: { flex: 1, padding: '24px 30px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' },
  statCard: { backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' },
  statLabel: { fontSize: '12px', color: '#64748b', fontWeight: '600', marginBottom: '6px' },
  statValue: { fontSize: '28px', fontWeight: 'bold', color: '#0f172a' },
  panelCard: { backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' },
  panelTitle: { margin: '0 0 16px', fontSize: '16px', color: '#0f172a' },
  listRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f1f5f9', fontSize: '14px' },
  roleBadgeManager: { backgroundColor: '#fef3c7', color: '#b45309', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' },
  roleBadgeMember: { backgroundColor: '#eff6ff', color: '#2563eb', padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }
};