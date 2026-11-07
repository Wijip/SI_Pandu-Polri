
import React, { useState, useEffect, useCallback, useLayoutEffect, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { 
  Personnel, 
  ResetRequest, 
  SiteSettings, 
  Notification, 
  UserRole,
  RequestStatus,
  LogEntry,
  RequestPriority
} from './types';
import Sidebar from './components/Sidebar';
import MobileTopbar from './components/MobileTopbar';
import Toast from './components/Toast';

// Fase 8.5: Code Splitting via React.lazy for route-based views
const Dashboard = React.lazy(() => import('./views/Dashboard'));
const ResetRequests = React.lazy(() => import('./views/ResetRequests'));
const PersonnelData = React.lazy(() => import('./views/PersonnelData'));
const Reports = React.lazy(() => import('./views/Reports'));
const Logs = React.lazy(() => import('./views/Logs'));
const Settings = React.lazy(() => import('./views/Settings'));
const Login = React.lazy(() => import('./views/Login'));

const ProtectedRoute: React.FC<React.PropsWithChildren<{ 
  currentUser: Personnel | null, 
  superAdminOnly?: boolean,
  anyAdminOnly?: boolean,
  allowUser?: boolean
}>> = ({ children, currentUser, superAdminOnly = false, anyAdminOnly = false, allowUser = false }) => {
  if (!currentUser) return <Navigate to="/login" replace />;
  
  if (superAdminOnly && currentUser.role !== UserRole.SUPERADMIN) return <Navigate to="/" replace />;
  
  if (anyAdminOnly && currentUser.role === UserRole.USER && !allowUser) return <Navigate to="/" replace />;
  
  return <>{children}</>;
};

const DATA_VERSION = 'v2.9'; // Increment this to force data update for all users

const App: React.FC = () => {
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(() => {
    const saved = localStorage.getItem('SITE_SETTINGS');
    return saved ? JSON.parse(saved) : { 
      name: 'Polda Jatim', 
      logo: '/img/Pandu.png',
      loginTitle: 'Reset Password Email Polri',
      loginSubtitle: 'Bid Tik Polda Jatim',
      loginTagline1: 'MENGABDI DENGAN INTEGRITAS',
      loginTagline2: 'MELAYANI DENGAN TEKNOLOGI',
      requestsTitle: 'Manajemen Reset Password',
      requestsSubtitle: 'PANTAU DAN EKSEKUSI PERMOHONAN AKSES PERSONEL',
      darkMode: false
    };
  });

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentUser, setCurrentUser] = useState<Personnel | null>(() => {
    const saved = localStorage.getItem('user_profile');
    return saved ? JSON.parse(saved) : null;
  });

  // Session check on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('/api/me', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setCurrentUser(data.user);
        } else {
          // If session is invalid, clear local storage and redirect
          localStorage.removeItem('user_profile');
          setCurrentUser(null);
        }
      } catch (error) {
        console.error('Session check failed:', error);
      }
    };
    checkSession();
  }, []);

  // Fetch site settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          setSiteSettings(prev => ({ ...prev, ...data }));
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      }
    };
    fetchSettings();
  }, []);

  // Fetch initial data from API (Fase 8.3: Eliminasi duplicate requests?limit=all & personnel?limit=all)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const fetchTasks: Promise<Response>[] = [
          fetch('/api/stats', { credentials: 'include' })
        ];
        
        const isSuperAdmin = currentUser?.role === UserRole.SUPERADMIN;
        if (isSuperAdmin) {
          fetchTasks.push(fetch('/api/logs', { credentials: 'include' }));
        }

        const results = await Promise.all(fetchTasks);
        const sRes = results[0];
        const lRes = isSuperAdmin ? results[1] : null;
        
        if (lRes && lRes.ok) setLogs(await lRes.json());
        if (sRes && sRes.ok) {
          await sRes.json();
        }
      } catch (error) {
        console.error('Failed to fetch data from API:', error);
      }
    };
    if (currentUser && (currentUser.role === UserRole.SUPERADMIN || currentUser.role === UserRole.ADMIN)) {
      fetchData();
    }
  }, [currentUser]);

  const [toasts, setToasts] = useState<{id: string, message: string, type: 'success' | 'error'}[]>([]);
  const [hasUrgentRequest, setHasUrgentRequest] = useState(false);

  // Socket.io Integration
  useEffect(() => {
    if (!currentUser) return;
    const socket = io({ withCredentials: true });

    socket.on('urgent_request', (data) => {
      if (currentUser && (currentUser.role === UserRole.SUPERADMIN || currentUser.role === UserRole.ADMIN)) {
        setHasUrgentRequest(true);
        showToast(`URGENT: Permintaan reset dari ${data.nama} (NRP: ${data.nrp})`, 'error');
        addNotification('URGENT REQUEST', `Permintaan reset mendesak dari ${data.nama}`, 'request', data.id);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('SITE_SETTINGS', JSON.stringify(siteSettings));
  }, [siteSettings]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('user_profile', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('user_profile');
    }
  }, [currentUser]);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const addLog = useCallback(async (aktivitas: LogEntry['aktivitas'], keterangan: string) => {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ aktivitas, keterangan })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.log) {
          setLogs(prev => [data.log, ...prev]);
          return;
        }
      }
    } catch (e) {
      console.error('Failed to save log to API', e);
    }

    // Fallback optimis jika respon server terkendala
    const fallbackLog: LogEntry = {
      id: `L-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      waktu: Date.now(),
      user: {
        nama: currentUser.nama,
        role: currentUser.role === UserRole.SUPERADMIN ? 'Super Admin' : currentUser.role === UserRole.ADMIN ? 'Admin Polres' : 'Personel',
        initials: currentUser.nama.split(' ').map(n => n[0]).join('').toUpperCase()
      },
      aktivitas,
      keterangan,
      ipAddress: '127.0.0.1'
    };
    setLogs(prev => [fallbackLog, ...prev]);
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      await addLog('Sistem', 'Pengguna melakukan logout dari sistem');
    } catch (e) {
      console.error('Failed to log logout');
    }
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('Logout API failed');
    }
    localStorage.removeItem('user_profile');
    setCurrentUser(null);
  };

  const addNotification = (title: string, body: string, type: 'request' | 'system' | 'personnel', refId?: string) => {
    const newNotif: Notification = {
      id: Math.random().toString(36).substr(2, 9),
      title,
      body,
      time: Date.now(),
      read: false,
      type,
      refId
    };
    setNotifications(prev => [newNotif, ...prev]);
  };


  return (
    <HashRouter>
      <div className={`min-h-screen flex flex-col md:flex-row transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
        {currentUser && (
          <>
            <Sidebar 
              siteSettings={siteSettings} 
              setSiteSettings={setSiteSettings}
              currentUser={currentUser} 
              onLogout={handleLogout} 
              hasUrgentRequest={hasUrgentRequest}
              setHasUrgentRequest={setHasUrgentRequest}
            />
            <MobileTopbar 
              siteSettings={siteSettings} 
              setSiteSettings={setSiteSettings}
              notifications={notifications} 
              currentUser={currentUser} 
              onLogout={handleLogout}
            />
          </>
        )}

        <div className={`flex-1 flex flex-col min-w-0 ${currentUser ? 'pt-14 md:pt-0' : ''}`}>
          <Suspense fallback={
            <div className="flex-1 flex items-center justify-center min-h-[60vh]">
              <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          }>
            <Routes>
              <Route path="/login" element={<Login onLogin={(user) => { setCurrentUser(user); }} addLog={addLog} siteSettings={siteSettings} currentUser={currentUser} />} />
              
              <Route path="/" element={
                <ProtectedRoute currentUser={currentUser}>
                  {(currentUser?.role === UserRole.SUPERADMIN || currentUser?.role === UserRole.ADMIN) ? (
                    <Dashboard requests={requests} personnel={personnel} showToast={showToast} currentUser={currentUser!} siteSettings={siteSettings} />
                  ) : (
                    <Navigate to="/requests" replace />
                  )}
                </ProtectedRoute>
              } />
              
              <Route path="/requests" element={
                <ProtectedRoute anyAdminOnly allowUser currentUser={currentUser}>
                  <ResetRequests 
                    showToast={showToast}
                    addNotification={addNotification}
                    addLog={addLog}
                    siteSettings={siteSettings}
                    setSiteSettings={setSiteSettings}
                    currentUser={currentUser as Personnel}
                  />
                </ProtectedRoute>
              } />
              
              <Route path="/personnel" element={
                <ProtectedRoute anyAdminOnly currentUser={currentUser}>
                  <PersonnelData 
                    personnel={personnel} 
                    setPersonnel={setPersonnel} 
                    showToast={showToast}
                    addLog={addLog}
                    siteSettings={siteSettings}
                    currentUser={currentUser as Personnel}
                  />
                </ProtectedRoute>
              } />

              <Route path="/reports" element={
                <ProtectedRoute anyAdminOnly currentUser={currentUser}>
                  <Reports requests={requests} showToast={showToast} siteSettings={siteSettings} currentUser={currentUser as Personnel} />
                </ProtectedRoute>
              } />

              <Route path="/logs" element={
                <ProtectedRoute superAdminOnly currentUser={currentUser}>
                  <Logs logs={logs} showToast={showToast} siteSettings={siteSettings} />
                </ProtectedRoute>
              } />
              
              <Route path="/settings" element={
                <ProtectedRoute anyAdminOnly allowUser currentUser={currentUser}>
                  <Settings 
                    siteSettings={siteSettings} 
                    setSiteSettings={setSiteSettings} 
                    currentUser={currentUser as Personnel}
                    setCurrentUser={setCurrentUser}
                    showToast={showToast}
                    addLog={addLog}
                  />
                </ProtectedRoute>
              } />
              
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>

        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none print:hidden">
          {toasts.map(t => (
            <Toast key={t.id} message={t.message} type={t.type} />
          ))}
        </div>
      </div>
    </HashRouter>
  );
};

export default App;
