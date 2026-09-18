
import React, { useState, useEffect, useCallback, useLayoutEffect } from 'react';
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
import Dashboard from './views/Dashboard';
import ResetRequests from './views/ResetRequests';
import PersonnelData from './views/PersonnelData';
import Reports from './views/Reports';
import Logs from './views/Logs';
import Settings from './views/Settings';
import Login from './views/Login';
import UserDashboard from './views/UserDashboard';
import PublicResetForm from './views/PublicResetForm';
import Sidebar from './components/Sidebar';
import MobileTopbar from './components/MobileTopbar';
import Toast from './components/Toast';

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

  // Fetch initial data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [lRes, sRes] = await Promise.all([
          fetch('/api/logs', { credentials: 'include' }),
          fetch('/api/stats', { credentials: 'include' })
        ]);
        
        if (lRes.ok) setLogs(await lRes.json());
        if (sRes.ok) {
          const statsData = await sRes.json();
          // We can remove setRequests and setPersonnel fetching here!
          // But wait, the app state might need requests/personnel for Notifications or Dashboard props?
          // I will store stats in state or keep simple
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
    const socket = io();

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
    const newLog: LogEntry = {
      id: `L-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      waktu: Date.now(),
      user: {
        nama: currentUser.nama,
        role: currentUser.role === UserRole.SUPERADMIN ? 'Super Admin' : currentUser.role === UserRole.ADMIN ? 'Admin Polres' : 'Personel',
        initials: currentUser.nama.split(' ').map(n => n[0]).join('').toUpperCase()
      },
      aktivitas,
      keterangan,
      ipAddress: '10.12.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255)
    };
    
    setLogs(prev => [newLog, ...prev]);
    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newLog)
      });
    } catch (e) {
      console.error('Failed to save log to API');
    }
  }, [currentUser]);

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('Logout API failed');
    }
    addLog('Sistem', 'Pengguna melakukan logout dari sistem');
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

  const submitPublicRequest = async (nrp: string, alasan: string, dokumen_kta?: string, prioritas?: any, file?: File) => {
    const person = personnel.find(p => p.nrp === nrp);
    if (!person) return { success: false, message: 'NRP tidak terdaftar dalam sistem.' };

    const formData = new FormData();
    formData.append('id', `REQ-${Math.floor(1000 + Math.random() * 9000)}`);
    formData.append('nama', person.nama);
    formData.append('pangkat', person.pangkat || '');
    formData.append('nrp', person.nrp);
    formData.append('jabatan', person.jabatan || '');
    formData.append('kesatuan', person.kesatuan || '');
    formData.append('waktu_iso', new Date().toISOString());
    formData.append('status', RequestStatus.MENUNGGU);
    formData.append('alasan', alasan);
    formData.append('prioritas', prioritas || 'Normal');
    formData.append('createdAt', Date.now().toString());
    
    if (file) {
      formData.append('dokumen_kta_file', file);
    } else if (dokumen_kta) {
      formData.append('dokumen_kta', dokumen_kta);
    }

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      
      if (res.ok) {
        const newRequest: ResetRequest = {
          id: formData.get('id') as string,
          nama: person.nama,
          pangkat: person.pangkat,
          nrp: person.nrp,
          jabatan: person.jabatan,
          kesatuan: person.kesatuan,
          waktu_iso: formData.get('waktu_iso') as string,
          status: RequestStatus.MENUNGGU,
          alasan: alasan,
          dokumen_kta: dokumen_kta, // This will be updated on next fetch
          prioritas: prioritas || 'Normal',
          createdAt: parseInt(formData.get('createdAt') as string)
        };
        setRequests(prev => [newRequest, ...prev]);
        addNotification('Permintaan Baru', `Pengajuan reset password dari NRP ${nrp}`, 'request', newRequest.id);
        return { success: true, message: 'Permintaan Anda telah dikirim ke Admin.' };
      }
      return { success: false, message: 'Gagal mengirim permintaan ke server.' };
    } catch (error) {
      return { success: false, message: 'Terjadi kesalahan koneksi.' };
    }
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
          <Routes>
            <Route path="/login" element={<Login onLogin={(user) => { setCurrentUser(user); }} addLog={addLog} siteSettings={siteSettings} currentUser={currentUser} />} />
            <Route path="/request-reset" element={<PublicResetForm onSubmit={submitPublicRequest} siteSettings={siteSettings} />} />
            
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
              <ProtectedRoute anyAdminOnly currentUser={currentUser}>
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
