
import React, { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { Personnel, ResetRequest, RequestStatus, SiteSettings } from '../types';

interface UserDashboardProps {
  currentUser: Personnel;
  requests: ResetRequest[];
  setRequests?: React.Dispatch<React.SetStateAction<ResetRequest[]>>;
  showToast?: (msg: string, type?: 'success' | 'error') => void;
  addNotification?: (title: string, body: string, type: 'request' | 'system' | 'personnel', refId?: string) => void;
  siteSettings: SiteSettings;
}

const UserDashboard: React.FC<UserDashboardProps> = ({ 
  currentUser, 
  requests, 
  setRequests, 
  showToast,
  addNotification,
  siteSettings
}) => {
  const isDarkMode = siteSettings.darkMode;
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('Semua status');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<ResetRequest | null>(null);
  const [showPasswordInDetail, setShowPasswordInDetail] = useState(false);
  
  // Form State
  const [formNama, setFormNama] = useState('');
  const [formPangkat, setFormPangkat] = useState('');
  const [formNRP, setFormNRP] = useState('');
  const [formJabatan, setFormJabatan] = useState('');
  const [formKontak, setFormKontak] = useState('');
  const [keterangan, setKeterangan] = useState('');
  const alasan = 'Lupa Password'; 

  // Helper Label Status
  const getStatusLabel = (status: RequestStatus) => {
    if (status === RequestStatus.MENUNGGU) return 'TERKIRIM';
    if (status === RequestStatus.DIPROSES) return 'DI PROSES';
    if (status === RequestStatus.SELESAI) return 'SELESAI';
    return status;
  };

  // Auto-fill form
  useEffect(() => {
    if (isModalOpen) {
      setFormNama(currentUser.nama || '');
      setFormPangkat(currentUser.pangkat || '');
      setFormNRP(currentUser.nrp || '');
      setFormJabatan(currentUser.jabatan || '');
      setFormKontak(currentUser.telepon || '');
      setKeterangan('');
    }
  }, [isModalOpen, currentUser]);

  const myRequests = useMemo(() => {
    return requests.filter(r => {
      const userNrp = (currentUser.nrp || '').trim();
      const reqNrp = (r.nrp || '').trim();
      const userUnit = (currentUser.kesatuan || '').trim();
      const reqUnit = (r.kesatuan || '').trim();

      const isMine = reqNrp === userNrp || (reqUnit === userUnit && userUnit !== '');
      
      const matchesSearch = 
        (r.id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.nama || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (r.nrp || '').includes(searchTerm);
      
      const matchesStatus = statusFilter === 'Semua status' || getStatusLabel(r.status) === statusFilter.toUpperCase();
      
      return isMine && matchesSearch && matchesStatus;
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [requests, currentUser, searchTerm, statusFilter]);

  const handleAjukanReset = async () => {
    if (!formNama.trim() || !formNRP.trim()) {
      showToast?.('Nama dan NRP wajib diisi', 'error');
      return;
    }

    const requestId = `REQ-${Math.floor(1000 + Math.random() * 8999)}`;
    const newRequest: ResetRequest = {
      id: requestId,
      nama: formNama,
      pangkat: formPangkat,
      nrp: formNRP,
      jabatan: formJabatan,
      kesatuan: currentUser.kesatuan,
      kontak_person: formKontak,
      waktu_iso: new Date().toISOString(),
      status: RequestStatus.MENUNGGU,
      alasan: alasan,
      catatan: keterangan,
      createdAt: Date.now()
    };

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRequest)
      });
      if (!res.ok) throw new Error('Failed to submit request');

      if (setRequests) {
        setRequests(prev => [newRequest, ...prev]);
        addNotification?.('Permintaan Reset Baru', `Personel ${formNama} mengajukan reset.`, 'request', requestId);
        showToast?.('Permintaan reset password berhasil dikirim');
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error('Submit failed:', error);
      showToast?.('Gagal mengirim permintaan ke server', 'error');
    }
  };

  return (
    <motion.main 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-4 md:p-8 space-y-6 max-w-full mx-auto min-h-screen font-sans transition-colors duration-300 ${isDarkMode ? 'bg-slate-950' : 'bg-slate-50'}`}
    >
      
      {/* HEADER SECTION - Match Screenshot */}
      <div className={`rounded-xl p-4 md:p-5 flex items-center justify-between shadow-sm border transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        <div className="flex items-center gap-3 md:gap-4">
          <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center shadow-sm ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
            <span className="material-symbols-outlined text-xl md:text-2xl">shield</span>
          </div>
          <div>
            <h1 className={`text-sm md:text-base font-bold leading-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Sistem Reset Password</h1>
            <p className="text-[10px] md:text-xs text-slate-400 font-medium">Polda Jatim — Dashboard Personel</p>
          </div>
        </div>
        <button 
          onClick={() => window.location.hash = '/login'}
          className={`p-2 md:p-2.5 rounded-lg border transition-all ${isDarkMode ? 'border-slate-800 text-slate-500 hover:text-slate-300' : 'border-slate-200 text-slate-400 hover:text-slate-900'}`}
        >
          <span className="material-symbols-outlined text-xl">logout</span>
        </button>
      </div>

      {/* ACTION CARD - Match Screenshot */}
      <div className={`rounded-xl p-6 md:p-8 shadow-sm border space-y-4 md:space-y-6 transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        <div className="flex items-center gap-3">
           <span className="material-symbols-outlined text-blue-600">badge</span>
           <h2 className={`text-sm font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>Ajukan Permintaan Reset</h2>
        </div>
        <p className={`text-[11px] md:text-xs leading-relaxed max-w-3xl ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
          Gunakan tombol di bawah untuk mengajukan permintaan reset password akun dinas. <br/>
          Jika Anda lupa password atau akun terkunci, ajukan permintaan reset melalui tombol berikut.
        </p>
        
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 md:gap-4">
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 md:px-10 py-3.5 rounded-lg font-bold text-xs flex items-center justify-center gap-3 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
          >
            <span className="material-symbols-outlined text-xl">send</span>
            Ajukan Reset Password
          </button>
          <button className={`flex items-center justify-center gap-2 px-6 py-3.5 border rounded-lg text-xs font-bold transition-colors active:scale-95 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
             <span className="material-symbols-outlined text-xl">help</span>
             Bantuan
          </button>
        </div>
        <p className="text-[10px] md:text-[11px] text-slate-400 font-medium italic">Setelah pengajuan dikirim, Anda akan menerima notifikasi pada halaman ini ketika status berubah.</p>
      </div>

      {/* RIWAYAT PENGAJUAN TABLE - Match Screenshot Layout */}
      <div className={`rounded-xl shadow-sm border overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        <div className="p-8 space-y-4">
          <div className="flex items-center gap-3">
             <span className="material-symbols-outlined text-blue-600">history</span>
             <div>
                <h3 className={`text-sm font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>Riwayat Pengajuan</h3>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">Semua pengajuan reset password untuk unit Anda</p>
             </div>
          </div>

          {/* TABLE TOOLBAR - Match Screenshot */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
              <input 
                type="text" 
                placeholder="Cari ID, nama, NRP..." 
                className={`w-full h-[44px] pl-10 pr-4 py-2 border rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100'}`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <select 
                className={`flex-1 md:flex-none h-[44px] px-4 border rounded-lg text-xs font-medium outline-none transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'}`}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option>Semua status</option>
                <option>Terkirim</option>
                <option>Di Proses</option>
                <option>Selesai</option>
              </select>
              <button className={`h-[44px] px-4 border rounded-lg text-xs font-bold transition-colors active:scale-95 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                <span className="material-symbols-outlined text-lg">refresh</span>
              </button>
            </div>
            <div className="hidden md:flex items-center gap-2">
              <button className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-xs font-bold transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-emerald-400 hover:bg-slate-700' : 'bg-white border-slate-200 text-emerald-600 hover:bg-emerald-50'}`}>
                 <span className="material-symbols-outlined text-lg">table_view</span>
                 Export
              </button>
              <button className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-xs font-bold transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-rose-400 hover:bg-slate-700' : 'bg-white border-slate-200 text-rose-600 hover:bg-rose-50'}`}>
                 <span className="material-symbols-outlined text-lg">picture_as_pdf</span>
                 PDF
              </button>
            </div>
          </div>
        </div>

        {/* DATA TABLE - Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1400px]">
            <thead>
              <tr className={`border-y transition-colors ${isDarkMode ? 'bg-slate-800/30 border-slate-800' : 'bg-slate-50/30 border-slate-100'}`}>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Tanggal</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>ID Tiket</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Nama</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Pangkat</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>NRP</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Jabatan</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Kesatuan</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Kontak Person</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Alasan</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Keterangan</th>
                <th className={`px-6 py-4 text-[10px] font-bold uppercase text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-800'}`}>Status</th>
              </tr>
            </thead>
            <tbody className={`divide-y transition-colors ${isDarkMode ? 'divide-slate-800' : 'divide-slate-50'}`}>
              {myRequests.map((req) => (
                <tr 
                  key={req.id} 
                  className={`transition-colors cursor-pointer group ${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-slate-50/50'}`}
                  onClick={() => { setSelectedDetail(req); setShowPasswordInDetail(false); }}
                >
                  <td className={`px-6 py-5 text-xs font-bold text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    {new Date(req.createdAt).toLocaleDateString('id-ID')}
                  </td>
                  <td className="px-6 py-5 text-center">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold font-mono ${isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-700'}`}>{req.id}</span>
                  </td>
                  <td className={`px-6 py-5 text-xs font-bold text-center uppercase ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>{req.nama}</td>
                  <td className="px-6 py-5 text-xs font-medium text-slate-500 text-center uppercase">{req.pangkat}</td>
                  <td className={`px-6 py-5 text-xs font-bold text-center font-mono ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{req.nrp}</td>
                  <td className="px-6 py-5 text-xs font-medium text-slate-500 text-center uppercase">{req.jabatan}</td>
                  <td className={`px-6 py-5 text-xs font-bold text-center uppercase ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{req.kesatuan}</td>
                  <td className="px-6 py-5 text-xs font-medium text-slate-500 text-center">{req.kontak_person || '-'}</td>
                  <td className="px-6 py-5 text-xs font-medium text-slate-500 text-center">{req.alasan}</td>
                  <td className="px-6 py-5 text-xs font-medium text-slate-500 text-center max-w-[200px] truncate italic">
                    {req.catatan || '-'}
                  </td>
                  <td className="px-6 py-5 text-center">
                    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                      req.status === RequestStatus.MENUNGGU ? (isDarkMode ? 'bg-amber-500/10 text-amber-500' : 'bg-amber-50 text-amber-600') :
                      req.status === RequestStatus.DIPROSES ? (isDarkMode ? 'bg-blue-500/10 text-blue-500' : 'bg-blue-50 text-blue-600') : (isDarkMode ? 'bg-emerald-500/10 text-emerald-500' : 'bg-emerald-50 text-emerald-600')
                    }`}>
                      {getStatusLabel(req.status)}
                    </span>
                  </td>
                </tr>
              ))}
              {myRequests.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-16 text-center">
                    <p className="text-xs font-medium text-slate-400">Belum ada pengajuan untuk unit Anda.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* DATA CARD VIEW - Mobile */}
        <div className="md:hidden divide-y transition-colors duration-300 divide-slate-100 dark:divide-slate-800">
          {myRequests.map((req) => (
            <div 
              key={req.id} 
              className={`p-5 space-y-4 active:scale-[0.98] transition-all ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}
              onClick={() => { setSelectedDetail(req); setShowPasswordInDetail(false); }}
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black font-mono ${isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-slate-100 text-slate-500'}`}>
                      {req.id}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">{new Date(req.createdAt).toLocaleDateString('id-ID')}</span>
                  </div>
                  <h4 className={`text-sm font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{req.nama}</h4>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{req.pangkat} — {req.nrp}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                  req.status === RequestStatus.MENUNGGU ? (isDarkMode ? 'bg-amber-500/10 text-amber-500' : 'bg-amber-50 text-amber-600') :
                  req.status === RequestStatus.DIPROSES ? (isDarkMode ? 'bg-blue-500/10 text-blue-500' : 'bg-blue-50 text-blue-600') : (isDarkMode ? 'bg-emerald-500/10 text-emerald-500' : 'bg-emerald-50 text-emerald-600')
                }`}>
                  {getStatusLabel(req.status)}
                </span>
              </div>
              
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                    <span className="material-symbols-outlined text-lg">account_balance</span>
                  </div>
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">{req.kesatuan}</div>
                </div>
                <button className="text-blue-600 text-[10px] font-black uppercase tracking-widest">Detail</button>
              </div>
            </div>
          ))}
          {myRequests.length === 0 && (
            <div className="p-12 text-center">
              <span className="material-symbols-outlined text-4xl opacity-20">history</span>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Belum ada riwayat</p>
            </div>
          )}
        </div>
      </div>

      {/* MODAL DETAIL */}
      <AnimatePresence>
        {selectedDetail && (
          <div className="fixed inset-0 z-[110] flex items-end md:items-center justify-center md:p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 100 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 100 }}
              className={`rounded-t-[2.5rem] md:rounded-3xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}
            >
              <div className={`p-6 md:p-8 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800' : 'border-slate-50'}`}>
                <div>
                  <h3 className={`text-base md:text-lg font-bold ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Rincian Pengajuan</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">ID TIKET: {selectedDetail.id}</p>
                </div>
                <button onClick={() => setSelectedDetail(null)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div className="p-6 md:p-8 space-y-6">
                <div className="grid grid-cols-2 gap-3 md:gap-4">
                  <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Status</p>
                    <span className="text-xs font-bold text-blue-600">{getStatusLabel(selectedDetail.status)}</span>
                  </div>
                  <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Tanggal</p>
                    <span className={`text-xs font-bold ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>{new Date(selectedDetail.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {(selectedDetail.status === RequestStatus.SELESAI || String(selectedDetail.status).toUpperCase() === 'SELESAI') && (
                  <div className={`p-6 rounded-2xl space-y-3 transition-colors duration-300 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PASSWORD BARU</p>
                    <div className="relative flex items-center justify-between">
                      <input 
                        type="text" 
                        readOnly 
                        className={`bg-transparent border-none p-0 text-sm font-bold outline-none flex-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}
                        value={showPasswordInDetail 
                          ? (selectedDetail.reset_password || '') 
                          : '••••••••'}
                      />
                      <div className="flex items-center gap-2 ml-4">
                        <button 
                          type="button"
                          onClick={() => setShowPasswordInDetail(!showPasswordInDetail)}
                          className={`p-2 rounded-xl transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-200'}`}
                          title={showPasswordInDetail ? "Sembunyikan" : "Tampilkan"}
                        >
                          <span className="material-symbols-outlined text-lg">{showPasswordInDetail ? 'visibility' : 'visibility_off'}</span>
                        </button>
                        <button 
                          type="button"
                          onClick={() => {
                            if (selectedDetail.reset_password) {
                              navigator.clipboard.writeText(selectedDetail.reset_password);
                              showToast?.('Password berhasil disalin!', 'success');
                            }
                          }}
                          className={`p-2 rounded-xl transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-200'}`}
                          title="Salin Password"
                        >
                          <span className="material-symbols-outlined text-lg">content_copy</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="space-y-3 md:space-y-4">
                   <div className={`p-4 rounded-xl flex items-center justify-between ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                      <p className="text-xs font-medium text-slate-500">Kontak Person</p>
                      <p className={`text-xs font-bold ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>{selectedDetail.kontak_person || '-'}</p>
                   </div>
                   <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                      <p className="text-xs font-medium text-slate-500 mb-2">Catatan Admin</p>
                      <p className={`text-xs font-bold italic ${isDarkMode ? 'text-slate-400' : 'text-slate-700'}`}>"{selectedDetail.catatan || 'Tidak ada catatan tambahan.'}"</p>
                   </div>
                </div>

                <button onClick={() => setSelectedDetail(null)} className={`w-full h-[56px] rounded-xl font-bold text-xs uppercase tracking-widest transition-colors ${isDarkMode ? 'bg-slate-100 text-slate-900 hover:bg-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>Tutup</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FORM MODAL - Updated to include Contact Person */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center md:p-4 bg-slate-900/60 backdrop-blur-sm">
             <motion.div 
               initial={{ opacity: 0, scale: 0.9, y: 100 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.9, y: 100 }}
               className={`rounded-t-[2.5rem] md:rounded-2xl w-full max-w-xl shadow-2xl flex flex-col p-6 md:p-8 space-y-6 transition-colors ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}
             >
                <div className={`flex items-center gap-3 border-b pb-4 ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                  <span className="material-symbols-outlined text-blue-600">edit_document</span>
                  <h3 className={`text-base font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>Form Pengajuan Reset Password</h3>
                </div>
                
                <div className="space-y-4">
                   <div className={`p-4 border rounded-xl transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Konfirmasi Identitas</p>
                      <p className={`text-sm font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>{currentUser.nama} / {currentUser.nrp}</p>
                      <p className="text-[10px] font-black text-blue-600 uppercase mt-1">{currentUser.kesatuan}</p>
                   </div>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Kontak Person (WhatsApp)</label>
                         <input 
                            type="text" 
                            className={`w-full h-[48px] px-4 border rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500/10 transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200'}`}
                            placeholder="Contoh: 08123456789"
                            value={formKontak}
                            onChange={(e) => setFormKontak(e.target.value)}
                         />
                      </div>
                      <div className="space-y-1.5">
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Alasan</label>
                         <input 
                            type="text" 
                            readOnly
                            className={`w-full h-[48px] px-4 border rounded-xl text-xs font-bold outline-none transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-500' : 'bg-slate-50 border-slate-100 text-slate-500'}`}
                            value={alasan}
                         />
                      </div>
                   </div>

                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Keterangan / Kendala (Opsional)</label>
                      <textarea 
                         className={`w-full px-4 py-3 border rounded-xl text-xs font-bold h-24 resize-none outline-none focus:ring-2 focus:ring-blue-500/10 transition-colors ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200'}`}
                         placeholder="Masukkan kendala spesifik..."
                         value={keterangan}
                         onChange={(e) => setKeterangan(e.target.value)}
                      />
                   </div>
                </div>
                
                <div className="flex gap-3 pt-4">
                   <button onClick={() => setIsModalOpen(false)} className={`flex-1 h-[52px] border rounded-xl font-bold text-xs transition-colors ${isDarkMode ? 'border-slate-800 text-slate-500 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>Batal</button>
                   <button 
                    onClick={handleAjukanReset} 
                    disabled={!formNama.trim() || !formNRP.trim() || !formKontak.trim()}
                    className={`flex-1 h-[52px] bg-blue-600 text-white rounded-xl font-bold uppercase tracking-widest text-xs hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all active:scale-95 ${(!formNama.trim() || !formNRP.trim() || !formKontak.trim()) ? 'opacity-50 cursor-not-allowed' : ''}`}
                   >
                    Kirim Pengajuan
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

    </motion.main>
  );
};

export default UserDashboard;
