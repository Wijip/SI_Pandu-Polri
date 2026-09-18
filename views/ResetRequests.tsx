
import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { useDebounce } from '../src/hooks/useDebounce';
import { ResetRequest, RequestStatus, LogEntry, SiteSettings, UserRole, Personnel, RequestPriority } from '../types';

interface ResetRequestsProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  addNotification: (title: string, body: string, type: 'request' | 'system' | 'personnel', refId?: string) => void;
  addLog?: (aktivitas: LogEntry['aktivitas'], keterangan: string) => void;
  siteSettings: SiteSettings;
  setSiteSettings: React.Dispatch<React.SetStateAction<SiteSettings>>;
  currentUser: Personnel;
}

const ResetRequests: React.FC<ResetRequestsProps> = ({ 
  showToast, 
  addNotification, 
  addLog,
  siteSettings,
  setSiteSettings,
  currentUser
}) => {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [isLoading, setIsLoading] = useState(false);
  const isSuperAdmin = currentUser.role === UserRole.SUPERADMIN;
  const isAdminPolres = currentUser.role === UserRole.ADMIN;
  const isUser = currentUser.role === UserRole.USER;
  const isAnyAdmin = isSuperAdmin || isAdminPolres || isUser;
  const isDarkMode = siteSettings.darkMode;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('Semua');
  const [filterPriority, setFilterPriority] = useState('Semua');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  const [appliedFilters, setAppliedFilters] = useState({
    search: '',
    status: 'Semua',
    priority: 'Semua',
    start: '',
    end: ''
  });

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        search: appliedFilters.search,
        status: appliedFilters.status,
        priority: appliedFilters.priority
      });
      
      const res = await fetch(`/api/requests?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const result = await res.json();
        setRequests(result.data);
        setTotalItems(result.total);
      } else if (res.status === 401) {
        // Session invalid, redirect to login
        localStorage.removeItem('user_profile');
        window.location.href = '/#/login';
      } else if (res.status === 403) {
        // Access denied but session still valid
        showToast('Akses ditolak. Anda tidak memiliki izin untuk melihat data ini.', 'error');
      }
    } catch (error) {
      console.error('Failed to fetch requests:', error);
      showToast('Gagal memuat data permintaan', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchRequests();
  }, [currentPage, appliedFilters]);

  const debouncedSearch = useDebounce(appliedFilters.search, 500);

  const [selectedReq, setSelectedReq] = useState<ResetRequest | null>(null);
  const [viewingReq, setViewingReq] = useState<ResetRequest | null>(null);
  const [rejectingReq, setRejectingReq] = useState<ResetRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showWeakWarning, setShowWeakWarning] = useState(false);
  const [showDetailPassword, setShowDetailPassword] = useState(false);
  const getPasswordStrength = (pass: string) => {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 8) score += 25;
    if (/[A-Z]/.test(pass)) score += 25;
    if (/[0-9]/.test(pass)) score += 25;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(pass)) score += 25;
    return score;
  };

  const passwordStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

  // State untuk Input Manual
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [nrpConflict, setNrpConflict] = useState<{ nrp: string, existingNama: string } | null>(null);
  const [importErrors, setImportErrors] = useState<{ row: number, nrp: string, nama: string, existingNama: string }[]>([]);
  const [manualForm, setManualForm] = useState({
    nama: '',
    pangkat: '',
    nrp: '',
    jabatan: '',
    kesatuan: !isSuperAdmin ? currentUser.kesatuan : '',
    prioritas: 'Bukan Prioritas',
    catatan: ''
  });

  // Helper untuk Label Status Dinamis
  const getStatusLabel = (status: RequestStatus) => {
    if (status === RequestStatus.MENUNGGU) {
      return isSuperAdmin ? 'Diterima' : 'Terkirim';
    }
    if (status === RequestStatus.DIPROSES) return 'Di Proses';
    if (status === RequestStatus.SELESAI) return 'Selesai';
    if (status === RequestStatus.DITOLAK) return 'Ditolak';
    return status;
  };

  const handleCopyPassword = (password: string) => {
    if (password) {
      navigator.clipboard.writeText(password);
      showToast('Password disalin!', 'success');
    }
  };

  const getPriorityColor = (priority?: RequestPriority) => {
    switch (priority) {
      case RequestPriority.MENDESAK:
        return isDarkMode ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-rose-50 border-rose-100 text-rose-600';
      case RequestPriority.PENTING:
        return isDarkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-amber-50 border-amber-100 text-amber-600';
      default:
        return isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500';
    }
  };

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isEditHeaderModalOpen, setIsEditHeaderModalOpen] = useState(false);
  const [headerForm, setHeaderForm] = useState({
    title: siteSettings.requestsTitle || 'Manajemen Reset Password',
    subtitle: siteSettings.requestsSubtitle || 'PANTAU DAN EKSEKUSI PERMOHONAN AKSES PERSONEL'
  });

  const [isExecutingReset, setIsExecutingReset] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isSavingHeader, setIsSavingHeader] = useState(false);

  const handleSaveHeader = () => {
    setIsSavingHeader(true);
    // Simulate a brief delay for UX
    setTimeout(() => {
      setSiteSettings(prev => ({
        ...prev,
        requestsTitle: headerForm.title,
        requestsSubtitle: headerForm.subtitle
      }));
      setIsEditHeaderModalOpen(false);
      setIsSavingHeader(false);
      showToast('Judul halaman berhasil diperbarui', 'success');
    }, 300);
  };

  const stats = useMemo(() => {
    // Note: Stats are now based on the current page or we might need a separate API for global stats
    // For now, let's just use the current requests list or assume we have global stats
    const total = totalItems;
    const pending = requests.filter(r => r.status === RequestStatus.MENUNGGU).length; // This is only for current page
    const processing = requests.filter(r => r.status === RequestStatus.DIPROSES).length;
    const urgent = requests.filter(r => r.prioritas === RequestPriority.MENDESAK && r.status !== RequestStatus.SELESAI).length;
    
    return { total, pending, processing, completedToday: 0, urgent };
  }, [requests, totalItems]);

  const filteredRequests = requests; // Data is already filtered by server
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  const handleApplyFilter = () => {
    setCurrentPage(1);
    setAppliedFilters({
      search: searchTerm,
      status: filterStatus,
      priority: filterPriority,
      start: startDate,
      end: endDate
    });
  };

  const handleResetFilter = () => {
    setSearchTerm('');
    setFilterStatus('Semua');
    setFilterPriority('Semua');
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
    setAppliedFilters({ search: '', status: 'Semua', priority: 'Semua', start: '', end: '' });
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredRequests.map(r => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Hapus ${selectedIds.length} permintaan terpilih?`)) {
      setIsBulkDeleting(true);
      try {
        await Promise.all(selectedIds.map(id => fetch(`/api/requests/${id}`, { method: 'DELETE', credentials: 'include' })));
        setRequests(prev => prev.filter(r => !selectedIds.includes(r.id)));
        showToast(`${selectedIds.length} permintaan berhasil dihapus`);
        addLog?.('Hapus Data', `Menghapus massal ${selectedIds.length} permintaan reset`);
        setSelectedIds([]);
      } catch (error) {
        console.error('Bulk delete failed:', error);
        showToast('Gagal menghapus beberapa data dari server', 'error');
      } finally {
        setIsBulkDeleting(false);
      }
    }
  };

  const handleBulkProcess = async () => {
    if (selectedIds.length === 0) return;
    setIsBulkProcessing(true);
    try {
      await Promise.all(selectedIds.map(id => {
        const req = requests.find(r => r.id === id);
        if (req && req.status === RequestStatus.MENUNGGU) {
          return fetch(`/api/requests/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ ...req, status: RequestStatus.DIPROSES })
          });
        }
        return Promise.resolve();
      }));
      
      setRequests(prev => prev.map(r => 
        selectedIds.includes(r.id) && r.status === RequestStatus.MENUNGGU 
          ? { ...r, status: RequestStatus.DIPROSES } 
          : r
      ));
      showToast(`${selectedIds.length} permintaan ditandai sedang diproses`);
      addLog?.('Update Data', `Memproses massal ${selectedIds.length} permintaan reset`);
      setSelectedIds([]);
    } catch (error) {
      console.error('Bulk process failed:', error);
      showToast('Gagal memperbarui status ke server', 'error');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const exportExcel = () => {
    const params = new URLSearchParams({
      search: appliedFilters.search,
      status: appliedFilters.status,
      priority: appliedFilters.priority
    });
    window.location.href = `/api/export-data?${params.toString()}`;
  };

  const validateNRP = async (nrp: string, nama: string) => {
    if (!nrp.trim()) return null;
    try {
      const res = await fetch(`/api/validate-nrp?nrp=${encodeURIComponent(nrp.trim())}&nama=${encodeURIComponent(nama.trim())}`, {
        credentials: 'include'
      });
      const data = await res.json();
      if (data.success && data.conflict) {
        return data.existingNama;
      }
    } catch (error) {
      console.error('Validation error:', error);
    }
    return null;
  };

  const downloadTemplate = () => {
    window.location.href = '/api/download-template';
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'xls') {
      showToast('Format file tidak valid. Gunakan .xlsx atau .xls', 'error');
      e.target.value = '';
      return;
    }

    setSelectedFile(file);
    e.target.value = '';
  };

  const handleUploadExcel = async () => {
    if (!selectedFile) return;
    setIsImporting(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const bstr = event.target?.result;
        // cellText: true ensures we get the formatted text
        const wb = XLSX.read(bstr, { type: 'binary', cellText: true, cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        // raw: false ensures we get the string representation of the cell
        const data = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' }) as any[];

        // Validate structure for User role
        if (isUser) {
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
          const headers: string[] = [];
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
            if (cell) headers.push(String(cell.v).trim());
          }
          
          const requiredHeaders = ['Nama Personel', 'NRP / NIP', 'Pangkat', 'JABATAN', 'KESATUAN', 'PRIORITAS', 'KETERANGAN'];
          const isValidStructure = requiredHeaders.every(h => headers.includes(h));
          
          if (!isValidStructure) {
            showToast('Format Excel tidak valid. Harap gunakan template terbaru.', 'error');
            setIsImporting(false);
            return;
          }
        }

        const errors: { row: number, nrp: string, nama: string, existingNama: string }[] = [];
        const validRequests: ResetRequest[] = [];

        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          
          let nrp = '';
          let nama = '';
          let pangkat = '';
          let jabatan = '';
          let kesatuan = '';
          let catatan = '';
          let alasan_val = 'Import Data Massal';
          let prioritas_val = 'Normal';

          if (isUser) {
            nama = String(item['Nama Personel'] || '').trim();
            nrp = String(item['NRP / NIP'] || '').trim();
            pangkat = String(item['Pangkat'] || '').trim();
            jabatan = String(item['JABATAN'] || '').trim();
            // Assume user's kesatuan if empty as backup logic
            kesatuan = String(item['KESATUAN'] || currentUser.kesatuan || '').trim();
            
            const rawPrioritas = String(item['PRIORITAS'] || 'Bukan Prioritas').trim();
            if (rawPrioritas === 'Prioritas Mendesak') {
              prioritas_val = 'Mendesak';
            } else {
              prioritas_val = 'Normal';
            }
            
            catatan = String(item['KETERANGAN'] || '').trim();
          } else {
            nrp = String(item.NRP || item.nrp || item.Nrp || item['NRP/NIP'] || '').trim();
            nama = String(item['Nama Lengkap'] || item.Nama || item.nama || item.NAMA || '').trim();
            pangkat = String(item.Pangkat || item.pangkat || item.PANGKAT || '-').trim();
            jabatan = String(item.Jabatan || item.jabatan || item.JABATAN || '-').trim();
            kesatuan = String(item.Kesatuan || item.kesatuan || item.KESATUAN || (isAdminPolres ? currentUser.kesatuan : 'Polda Jatim')).trim();
            catatan = String(item.Keterangan || item.keterangan || item.KETERANGAN || '-').trim();
            alasan_val = String(item.Alasan || item.alasan || item.ALASAN || 'Import Data Massal').trim();
            prioritas_val = (item.Prioritas || item.prioritas || item.PRIORITAS || 'Normal') as RequestPriority;
          }
          
          // Handle template column "Personel (Nama/NRP)" for Admin template
          const personelRaw = String(item['Personel (Nama/NRP)'] || item.Personel || '').trim();
          if (!isUser && personelRaw && (!nrp || !nama)) {
            if (personelRaw.includes('/')) {
              const parts = personelRaw.split('/');
              nama = parts[0].trim();
              nrp = parts[1].trim();
            } else {
              nama = personelRaw;
            }
          }

          if (!nrp || (isUser && i === 0 && nama === 'Budi Santoso')) continue; // Skip example row for user

          // Frontend Guard: Reject if JABATAN is empty
          if (!jabatan || jabatan.trim() === '' || jabatan === '-') {
            errors.push({ row: i + 2, nrp, nama, existingNama: 'JABATAN KOSONG' });
            continue;
          }

          const existingNama = await validateNRP(nrp, nama);
          if (existingNama) {
            errors.push({ row: i + 2, nrp, nama, existingNama });
          } else {
            validRequests.push({
              id: `IMP-${Date.now()}-${i}`,
              nama: nama || 'Tanpa Nama',
              pangkat: pangkat,
              nrp: nrp,
              jabatan: jabatan,
              kesatuan: kesatuan,
              waktu_iso: new Date().toISOString(),
              status: RequestStatus.MENUNGGU,
              alasan: alasan_val,
              catatan: catatan,
              createdAt: Date.now(),
              kontak_person: String(item.Kontak || item.kontak || item.kontak_person || item.KONTAK || '-').trim(),
              prioritas: prioritas_val as RequestPriority
            });
          }
        }

        if (errors.length > 0) {
          setImportErrors(errors);
        }

        if (validRequests.length > 0) {
          try {
            const results = await Promise.all(validRequests.map(async (r, idx) => {
              const res = await fetch('/api/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(r)
              });
              const data = await res.json();
              return { ok: res.ok, data, r, row: idx + 2 }; // Simplified row tracking for now
            }));

            const failed = results.filter(res => !res.ok);
            const succeeded = results.filter(res => res.ok);

            if (failed.length > 0) {
              const newErrors = failed.map(f => ({
                row: f.row, // This might be wrong if we skipped rows, but it's a start
                nrp: f.r.nrp,
                nama: f.r.nama,
                existingNama: f.data.message || 'Gagal menyimpan'
              }));
              setImportErrors(prev => [...prev, ...newErrors]);
            }

            if (succeeded.length > 0) {
              setRequests(prev => [...succeeded.map(s => s.r), ...prev]);
              showToast(`${succeeded.length} data berhasil diimport`);
              addLog?.('Sistem', `Melakukan import massal sebanyak ${succeeded.length} data`);
            }

            if (failed.length === 0) {
              setIsImportModalOpen(false);
              setSelectedFile(null);
              fetchRequests();
            }
          } catch (err) {
            console.error('Import save failed:', err);
            showToast('Gagal menyimpan data import ke server', 'error');
          }
        } else if (errors.length === 0) {
          showToast('Tidak ada data valid untuk diimport', 'error');
        }
      } catch (err) {
        console.error('Excel processing error:', err);
        showToast('Gagal memproses file Excel', 'error');
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsBinaryString(selectedFile);
  };

  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualForm.nama || !manualForm.nrp || !manualForm.kesatuan) {
      showToast('Mohon lengkapi Nama, NRP, dan Kesatuan', 'error');
      return;
    }

    // Final check before submit
    const existingNama = await validateNRP(manualForm.nrp, manualForm.nama);
    if (existingNama) {
      setNrpConflict({ nrp: manualForm.nrp, existingNama });
      return;
    }

    setIsSubmittingManual(true);
    const prioritas_val = manualForm.prioritas === 'Prioritas Mendesak' ? RequestPriority.MENDESAK : RequestPriority.NORMAL;

    const newReq: ResetRequest = {
      id: `REQ-MAN-${Math.floor(1000 + Math.random() * 8999)}`,
      nama: manualForm.nama.trim(),
      pangkat: manualForm.pangkat.trim(),
      nrp: manualForm.nrp.trim(),
      jabatan: manualForm.jabatan.trim(),
      kesatuan: manualForm.kesatuan.trim(),
      prioritas: prioritas_val,
      catatan: manualForm.catatan.trim(),
      waktu_iso: new Date().toISOString(),
      status: RequestStatus.MENUNGGU,
      alasan: 'Input Manual Admin',
      createdAt: Date.now()
    };

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newReq)
      });
      if (!res.ok) throw new Error('Failed to create');

      setRequests(prev => [newReq, ...prev]);
      showToast(`Permintaan untuk ${manualForm.nama} berhasil ditambahkan secara manual`);
      addLog?.('Sistem', `Menambah permintaan reset manual: ${manualForm.nama}`);
      setIsManualModalOpen(false);
      setManualForm({
        nama: '',
        pangkat: '',
        nrp: '',
        jabatan: '',
        kesatuan: !isSuperAdmin ? currentUser.kesatuan : '',
        prioritas: 'Bukan Prioritas',
        catatan: ''
      });
    } catch (error) {
      console.error('Manual submit failed:', error);
      showToast('Gagal menyimpan data ke server', 'error');
    } finally {
      setIsSubmittingManual(false);
    }
  };

  const [processingReqId, setProcessingReqId] = useState<string | null>(null);

  const handleStartProcess = async (reqId: string) => {
    const req = requests.find(r => r.id === reqId);
    if (!req) return;

    setProcessingReqId(reqId);
    try {
      const res = await fetch(`/api/requests/${reqId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...req, status: RequestStatus.DIPROSES })
      });
      if (!res.ok) throw new Error('Failed to update');

      setRequests(prev => prev.map(r => 
        r.id === reqId ? { ...r, status: RequestStatus.DIPROSES } : r
      ));
      showToast('Permintaan ditandai sedang diproses');
      addLog?.('Reset Password', `Memulai proses reset password untuk permintaan ID: ${reqId}`);
    } catch (error) {
      console.error('Start process failed:', error);
      showToast('Gagal memperbarui status ke server', 'error');
    } finally {
      setProcessingReqId(null);
    }
  };

  const checkPasswordStrength = (pass: string) => {
    // Kriteria Lemah: kurang dari 8 karakter ATAU tidak ada angka ATAU tidak ada simbol
    const hasNumber = /\d/.test(pass);
    const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(pass);
    return pass.length >= 8 && hasNumber && hasSymbol;
  };

  const handleReject = async () => {
    if (!rejectingReq || !rejectionReason.trim()) {
      showToast('Alasan penolakan wajib diisi', 'error');
      return;
    }

    setIsRejecting(true);
    try {
      const updatedReq = {
        ...rejectingReq,
        status: RequestStatus.DITOLAK,
        alasan_penolakan: rejectionReason,
        updatedAt: Date.now()
      };

      const res = await fetch(`/api/requests/${rejectingReq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updatedReq)
      });

      if (!res.ok) throw new Error('Failed to reject');

      setRequests(prev => prev.map(r => r.id === rejectingReq.id ? updatedReq : r));
      showToast(`Permintaan ${rejectingReq.nama} telah ditolak`);
      addLog?.('Tolak Permintaan', `Menolak permintaan reset password: ${rejectingReq.nama}. Alasan: ${rejectionReason}`);
      
      setRejectingReq(null);
      setRejectionReason('');
    } catch (error) {
      console.error('Reject failed:', error);
      showToast('Gagal menolak permintaan', 'error');
    } finally {
      setIsRejecting(false);
    }
  };

  const executeReset = async (bypassWarning = false) => {
    if (!selectedReq) return;
    if (!newPassword.trim()) {
      showToast('Password tidak boleh kosong', 'error');
      return;
    }

    const isStrong = checkPasswordStrength(newPassword);
    if (!isStrong && !bypassWarning) {
      setShowWeakWarning(true);
      return;
    }
    
    setIsExecutingReset(true);
    try {
      const updatedReq = { 
        ...selectedReq, 
        status: RequestStatus.SELESAI, 
        updatedAt: Date.now(),
        reset_password: newPassword,
        reset_info: { by: currentUser.nama, at_iso: new Date().toISOString(), password_set: true }
      };

      const res = await fetch(`/api/requests/${selectedReq.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updatedReq)
      });
      if (!res.ok) throw new Error('Failed to update');

      setRequests(prev => prev.map(r => 
        r.id === selectedReq?.id ? updatedReq : r
      ));
      showToast(`Password untuk ${selectedReq?.nama} berhasil diperbarui`);
      addLog?.('Reset Password', `Menyelesaikan permintaan reset password: ${selectedReq.nama}`);
      setSelectedReq(null);
      setNewPassword('');
      setShowWeakWarning(false);
    } catch (error) {
      console.error('Execute reset failed:', error);
      showToast('Gagal menyimpan hasil reset ke server', 'error');
    } finally {
      setIsExecutingReset(false);
    }
  };

  return (
    <main className={`p-4 md:p-6 space-y-4 min-h-screen font-sans print:bg-white print:p-0 animate-in fade-in duration-500 transition-colors duration-300 ${isDarkMode ? 'bg-slate-950' : 'bg-slate-50'}`}>
      
      {/* Judul Laporan Khusus Print - Sesuai Gambar */}
      <div className={`hidden print:block mb-6 border-b-[3px] pb-6 ${isDarkMode ? 'border-white' : 'border-slate-900'}`}>
        <h1 className={`text-3xl font-black uppercase tracking-tight leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>LAPORAN REKAPITULASI PERMINTAAN RESET PASSWORD</h1>
        <p className={`text-[11px] font-bold mt-3 uppercase tracking-widest ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
          SISTEM ADMINISTRASI {siteSettings.name.toUpperCase()} | DICETAK: {new Date().toLocaleDateString('id-ID')}, {new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      </div>

      {/* Header & Export Buttons */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 print:hidden mb-8">
        <div className="flex items-center gap-5">
          <div className={`w-14 h-14 rounded-[1.25rem] flex items-center justify-center shadow-2xl transition-transform hover:scale-105 ${isDarkMode ? 'bg-blue-600 text-white shadow-blue-900/40' : 'bg-slate-900 text-white shadow-slate-200'}`}>
             <span className="material-symbols-outlined text-3xl">lock_reset</span>
          </div>
          <div className="group relative">
            <h1 className={`text-2xl font-black tracking-tight leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
              {siteSettings.requestsTitle || 'Manajemen Reset Password'}
            </h1>
            <p className="text-[10px] text-slate-400 font-bold mt-2 uppercase tracking-[0.2em]">
              {siteSettings.requestsSubtitle || 'Pantau dan eksekusi permohonan akses personel'}
            </p>
            {isSuperAdmin && (
              <button 
                onClick={() => {
                  setHeaderForm({
                    title: siteSettings.requestsTitle || 'Manajemen Reset Password',
                    subtitle: siteSettings.requestsSubtitle || 'PANTAU DAN EKSEKUSI PERMOHONAN AKSES PERSONEL'
                  });
                  setIsEditHeaderModalOpen(true);
                }}
                className="absolute -right-8 top-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 hover:text-blue-600"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
              </button>
            )}
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {(isSuperAdmin || isUser) && (
            <div className="flex items-center gap-3 mr-2">
              <button 
                onClick={() => setIsManualModalOpen(true)}
                className="flex items-center gap-3 h-[46px] px-6 bg-blue-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5 active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-xl">add_circle</span>
                TAMBAH MANUAL
              </button>
              <button 
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-3 h-[46px] px-6 bg-emerald-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/20 hover:shadow-emerald-900/40 hover:-translate-y-0.5 active:scale-[0.97]"
              >
                <span className="material-symbols-outlined text-xl">upload_file</span>
                IMPORT EXCEL
              </button>
            </div>
          )}

          <div className={`flex items-center gap-2 p-1 rounded-2xl border ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-slate-100/50 border-slate-200'}`}>
            <button 
              onClick={downloadTemplate}
              className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all hover:scale-110 ${isDarkMode ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-white'}`}
              title="Unduh Template"
            >
              <span className="material-symbols-outlined text-xl">download</span>
            </button>
            <div className={`w-px h-6 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-200'}`}></div>
            <button 
              onClick={exportExcel} 
              className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all hover:scale-110 ${isDarkMode ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-white'}`}
              title="Export Excel"
            >
              <span className="material-symbols-outlined text-xl text-emerald-500">table_view</span>
            </button>
            <button 
              onClick={() => window.print()} 
              className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all hover:scale-110 ${isDarkMode ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-500 hover:text-slate-900 hover:bg-white'}`}
              title="Cetak PDF"
            >
              <span className="material-symbols-outlined text-xl text-rose-500">picture_as_pdf</span>
            </button>
          </div>
        </div>
      </div>

      {/* Statistical Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 md:gap-6 print:hidden mb-8">
        {[
          { label: 'Total Request', value: stats.total, sub: 'Seluruh pengajuan', icon: 'list_alt', color: 'blue', 
            bg: isDarkMode ? 'bg-blue-500/10 border-blue-500/20' : 'bg-blue-50 border-blue-100', 
            text: isDarkMode ? 'text-blue-400' : 'text-blue-600',
            hover: isDarkMode ? 'hover:border-blue-500/50 hover:bg-blue-500/20' : 'hover:border-blue-200 hover:bg-blue-100/50'
          },
          { label: isSuperAdmin ? 'Status: Diterima' : 'Status: Terkirim', value: stats.pending, sub: 'Butuh verifikasi segera', icon: 'hourglass_empty', color: 'amber', 
            bg: isDarkMode ? 'bg-amber-500/10 border-amber-500/20' : 'bg-amber-50 border-amber-100', 
            text: isDarkMode ? 'text-amber-400' : 'text-amber-600',
            hover: isDarkMode ? 'hover:border-amber-500/50 hover:bg-amber-500/20' : 'hover:border-amber-200 hover:bg-amber-100/50'
          },
          { label: 'Status: Diproses', value: stats.processing, sub: 'Sedang dalam pengerjaan', icon: 'sync', color: 'indigo', 
            bg: isDarkMode ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100', 
            text: isDarkMode ? 'text-indigo-400' : 'text-indigo-600',
            hover: isDarkMode ? 'hover:border-indigo-500/50 hover:bg-indigo-500/20' : 'hover:border-indigo-200 hover:bg-indigo-100/50'
          },
          { label: 'Status: Selesai', value: stats.completedToday, sub: 'Berhasil hari ini', icon: 'verified', color: 'emerald', 
            bg: isDarkMode ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-emerald-50 border-emerald-100', 
            text: isDarkMode ? 'text-emerald-400' : 'text-emerald-600',
            hover: isDarkMode ? 'hover:border-emerald-500/50 hover:bg-emerald-500/20' : 'hover:border-emerald-200 hover:bg-emerald-100/50'
          },
          { label: 'Prioritas Mendesak', value: stats.urgent, sub: 'Butuh tindakan cepat', icon: 'priority_high', color: 'rose', 
            bg: isDarkMode ? 'bg-rose-500/10 border-rose-500/20' : 'bg-rose-50 border-rose-100', 
            text: isDarkMode ? 'text-rose-400' : 'text-rose-600',
            hover: isDarkMode ? 'hover:border-rose-500/50 hover:bg-rose-500/20' : 'hover:border-rose-200 hover:bg-rose-100/50'
          }
        ].map((stat, i) => (
          <div key={i} className={`p-5 md:p-6 rounded-[2rem] border shadow-sm flex items-start justify-between group transition-all duration-500 cursor-default ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'} ${stat.hover} ${i === 4 ? 'col-span-2 lg:col-span-1' : ''}`}>
            <div className="space-y-1 md:space-y-2">
              <p className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">{stat.label}</p>
              <h4 className={`text-2xl md:text-4xl font-black tracking-tighter ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{stat.value}</h4>
              <p className="text-[8px] md:text-[10px] font-bold text-slate-400 mt-1">{stat.sub}</p>
            </div>
            <div className={`w-10 h-10 md:w-14 md:h-14 rounded-2xl flex items-center justify-center transition-all duration-500 group-hover:scale-110 group-hover:rotate-6 shadow-inner ${stat.bg} ${stat.text}`}>
              <span className="material-symbols-outlined text-xl md:text-3xl">{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className={`p-4 rounded-[2rem] border shadow-sm flex flex-col lg:flex-row items-center gap-4 print:hidden transition-all duration-300 mb-6 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        <div className="flex items-center gap-3 w-full lg:flex-1">
          <div className="relative flex-1 group">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl transition-colors group-focus-within:text-blue-500">search</span>
            <input 
              type="text" 
              placeholder="Cari Nama, NRP, atau Kesatuan..." 
              className={`w-full h-[50px] pl-12 pr-5 border rounded-2xl text-xs font-bold transition-all placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
          </div>
          <button 
            onClick={() => setIsFilterModalOpen(true)}
            className={`lg:hidden flex items-center justify-center w-[50px] h-[50px] border rounded-2xl transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-600'}`}
          >
            <span className="material-symbols-outlined">filter_list</span>
          </button>
        </div>
        
        <div className="hidden lg:flex items-center gap-4 w-full lg:w-auto">
          <div className="flex items-center gap-3">
            <select 
              className={`h-[50px] px-4 border rounded-2xl text-[10px] font-black outline-none min-w-[160px] cursor-pointer transition-all uppercase tracking-widest focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="Semua">Status: Semua</option>
              <option value={RequestStatus.MENUNGGU}>{isSuperAdmin ? 'Status: Diterima' : 'Status: Terkirim'}</option>
              <option value={RequestStatus.DIPROSES}>Status: Di Proses</option>
              <option value={RequestStatus.SELESAI}>Status: Selesai</option>
              <option value={RequestStatus.DITOLAK}>Status: Ditolak</option>
            </select>

            <select 
              className={`h-[50px] px-4 border rounded-2xl text-[10px] font-black outline-none min-w-[160px] cursor-pointer transition-all uppercase tracking-widest focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
            >
              <option value="Semua">Prioritas: Semua</option>
              <option value="NORMAL">Normal</option>
              <option value="PENTING">Penting</option>
              <option value="MENDESAK">Mendesak</option>
            </select>
          </div>

          <div className={`flex items-center gap-3 p-1.5 rounded-2xl border ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
            <div className="relative">
              <input 
                type="date" 
                className={`h-[38px] px-3 border-none bg-transparent text-[10px] font-black outline-none uppercase ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`} 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)} 
              />
              <span className="absolute -top-4 left-2 px-1 text-[8px] font-black text-slate-400 uppercase tracking-widest">Mulai</span>
            </div>
            <div className={`w-px h-6 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></div>
            <div className="relative">
              <input 
                type="date" 
                className={`h-[38px] px-3 border-none bg-transparent text-[10px] font-black outline-none uppercase ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`} 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
              />
              <span className="absolute -top-4 left-2 px-1 text-[8px] font-black text-slate-400 uppercase tracking-widest">Selesai</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={handleApplyFilter} className="h-[50px] px-8 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 transition-all active:scale-[0.97] shadow-xl shadow-blue-900/20 hover:shadow-blue-900/40">
              TERAPKAN
            </button>
            <button onClick={handleResetFilter} className={`h-[50px] px-5 border rounded-2xl font-black text-[10px] transition-all uppercase tracking-widest ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-700 hover:text-white' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}>
              RESET
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {!isAdminPolres && selectedIds.length > 0 && (
        <div className={`mb-6 p-5 rounded-[2rem] border flex flex-col md:flex-row items-center justify-between gap-4 animate-in slide-in-from-top-4 duration-500 shadow-xl ${isDarkMode ? 'bg-blue-600/10 border-blue-500/30 shadow-blue-900/20' : 'bg-blue-50 border-blue-100 shadow-blue-100/50'}`}>
          <div className="flex items-center gap-5">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform hover:scale-105 ${isDarkMode ? 'bg-blue-500 text-white shadow-blue-500/20' : 'bg-blue-600 text-white shadow-blue-600/20'}`}>
              <span className="material-symbols-outlined text-2xl">check_circle</span>
            </div>
            <div>
              <p className={`text-base font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{selectedIds.length} Permintaan Terpilih</p>
              <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] mt-0.5">Aksi Massal Tersedia</p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <button 
              onClick={handleBulkProcess}
              disabled={isBulkProcessing || isBulkDeleting}
              className={`flex-1 md:flex-none px-8 py-4 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all active:scale-95 shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2 ${isBulkProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isBulkProcessing ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-sm">autorenew</span>
                  Memproses...
                </>
              ) : (
                'Proses Massal'
              )}
            </button>
            <button 
              onClick={handleBulkDelete}
              disabled={isBulkDeleting || isBulkProcessing}
              className={`flex-1 md:flex-none px-8 py-4 bg-rose-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all active:scale-95 shadow-lg shadow-rose-900/20 flex items-center justify-center gap-2 ${isBulkDeleting ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isBulkDeleting ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-sm">autorenew</span>
                  Menghapus...
                </>
              ) : (
                'Hapus Massal'
              )}
            </button>
            <button 
              onClick={() => setSelectedIds([])}
              disabled={isBulkProcessing || isBulkDeleting}
              className={`flex-1 md:flex-none px-8 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${isDarkMode ? 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white' : 'bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900 border border-slate-200'} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Batal
            </button>
          </div>
        </div>
      )}

      <div className={`rounded-[2.5rem] border shadow-sm overflow-hidden print:border-[1pt] print:border-slate-300 print:rounded-3xl transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`border-b text-[11px] font-black uppercase tracking-widest print:bg-slate-50 print:text-slate-900 transition-colors duration-300 ${isDarkMode ? 'bg-slate-800/50 border-slate-800 text-slate-500' : 'bg-slate-50/50 border-slate-100 text-slate-400'}`}>
                {!isAdminPolres && (
                  <th className="px-8 py-6 text-center w-12 print:hidden">
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 rounded-lg border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={selectedIds.length === filteredRequests.length && filteredRequests.length > 0}
                      onChange={handleSelectAll}
                    />
                  </th>
                )}
                <th className="px-6 py-6 text-center w-12">NO.</th>
                <th className="px-6 py-6">WAKTU REQUEST</th>
                <th className="px-6 py-6">PERSONEL</th>
                <th className="px-6 py-6">KESATUAN</th>
                <th className="px-6 py-6 text-center">STATUS</th>
                <th className="px-6 py-6 text-center">PRIORITAS</th>
                <th className="px-6 py-6 text-center print:table-cell hidden">PASSWORD BARU</th>
                <th className="px-8 py-6 text-center print:hidden">AKSI</th>
              </tr>
            </thead>
            <tbody className={`divide-y transition-colors duration-300 ${isDarkMode ? 'divide-slate-800' : 'divide-slate-50'} print:divide-slate-200`}>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="animate-pulse">
                    {!isAdminPolres && <td className="px-8 py-6 text-center print:hidden"><div className={`h-5 w-5 rounded-lg mx-auto ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>}
                    <td className="px-6 py-6 text-center"><div className={`h-4 w-8 rounded mx-auto ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>
                    <td className="px-6 py-6"><div className={`h-4 w-24 rounded mb-2 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div><div className={`h-3 w-16 rounded ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>
                    <td className="px-6 py-6"><div className={`h-5 w-40 rounded mb-2 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div><div className={`h-3 w-20 rounded ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>
                    <td className="px-6 py-6"><div className={`h-8 w-32 rounded-xl ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>
                    <td className="px-6 py-6 text-center"><div className={`h-8 w-24 rounded-full mx-auto ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>
                    <td className="px-6 py-6 text-center"><div className={`h-6 w-20 rounded-lg mx-auto ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>
                    <td className="px-6 py-6 text-center hidden"><div className={`h-4 w-20 rounded mx-auto ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>
                    <td className="px-8 py-6 text-center print:hidden"><div className={`h-10 w-32 rounded-2xl mx-auto ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}></div></td>
                  </tr>
                ))
              ) : (
                <>
                  {filteredRequests.map((req, index) => (
                    <tr key={req.id} className={`transition-all duration-300 group ${isDarkMode ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50/50'} ${selectedIds.includes(req.id) ? (isDarkMode ? 'bg-blue-900/10' : 'bg-blue-50/30') : ''}`}>
                      {!isAdminPolres && (
                        <td className="px-8 py-5 text-center print:hidden">
                          <input 
                            type="checkbox" 
                            className="w-5 h-5 rounded-lg border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={selectedIds.includes(req.id)}
                            onChange={() => handleSelectOne(req.id)}
                          />
                        </td>
                      )}
                      <td className={`px-6 py-5 text-center text-[11px] font-black print:text-slate-900 ${isDarkMode ? 'text-slate-600' : 'text-slate-400'}`}>{(currentPage - 1) * itemsPerPage + index + 1}</td>
                      <td className="px-6 py-5">
                        <div className={`text-[11px] font-black print:text-slate-900 ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{new Date(req.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                        <div className="text-[10px] text-slate-400 font-bold mt-1 uppercase tracking-widest print:text-slate-500">{new Date(req.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB</div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm shadow-sm transition-transform group-hover:scale-110 ${isDarkMode ? 'bg-slate-800 text-blue-400' : 'bg-slate-100 text-blue-600'}`}>
                            {req.nama.charAt(0)}
                          </div>
                          <div className="flex flex-col">
                            <div className={`text-[13px] font-black uppercase tracking-tight print:text-slate-900 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{req.nama}</div>
                            <div className="flex items-center gap-2 mt-1">
                               <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest print:text-slate-500">{req.pangkat}</span>
                               <span className={`w-1 h-1 rounded-full print:bg-slate-300 ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></span>
                               <span className={`text-[10px] font-black font-mono print:text-slate-600 ${isDarkMode ? 'text-slate-500' : 'text-slate-500'}`}>{req.nrp}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 w-fit transition-all print:bg-transparent print:p-0 print:text-slate-900 print:font-black ${isDarkMode ? 'bg-slate-800 text-slate-400 group-hover:bg-blue-600 group-hover:text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-900 group-hover:text-white'}`}>
                          <span className="material-symbols-outlined text-sm print:text-base">account_balance</span>
                          {req.kesatuan}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className={`inline-flex items-center gap-2 px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest print:bg-transparent print:p-0 print:text-xs print:font-black ${
                          req.status === RequestStatus.MENUNGGU ? (isDarkMode ? 'bg-amber-500/10 text-amber-500' : 'bg-amber-100/50 text-amber-700') :
                          req.status === RequestStatus.DIPROSES ? (isDarkMode ? 'bg-blue-500/10 text-blue-500' : 'bg-blue-100/50 text-blue-700') : 
                          req.status === RequestStatus.DITOLAK ? (isDarkMode ? 'bg-rose-500/10 text-rose-500' : 'bg-rose-100/50 text-rose-700') :
                          (isDarkMode ? 'bg-emerald-500/10 text-emerald-500' : 'bg-emerald-100/50 text-emerald-700')
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${req.status === RequestStatus.MENUNGGU ? 'bg-amber-500' : req.status === RequestStatus.DIPROSES ? 'bg-blue-500' : req.status === RequestStatus.DITOLAK ? 'bg-rose-500' : 'bg-emerald-500'} print:hidden`}></span>
                          {getStatusLabel(req.status)}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border ${getPriorityColor(req.prioritas)}`}>
                          <span className="material-symbols-outlined text-xs">{req.prioritas === RequestPriority.MENDESAK ? 'priority_high' : 'circle'}</span>
                          {req.prioritas || 'NORMAL'}
                        </div>
                      </td>
                      <td className={`px-6 py-5 text-center print:table-cell hidden font-mono text-[11px] font-black uppercase ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        {req.reset_password || '-'}
                      </td>
                      <td className="px-8 py-5 text-center print:hidden">
                        <div className="flex items-center justify-center gap-2">
                          <div className={`flex items-center gap-1 p-1 rounded-2xl border ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                            <button 
                              onClick={() => { 
                                setViewingReq(req); 
                                setShowDetailPassword((isSuperAdmin || isAdminPolres) && req.status === RequestStatus.SELESAI); 
                              }}
                              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-400 hover:bg-white hover:text-slate-900 hover:shadow-sm'}`}
                              title="Detail"
                            >
                              <span className="material-symbols-outlined text-lg">visibility</span>
                            </button>
                            
                            {isSuperAdmin && (
                              <>
                                {req.status === RequestStatus.MENUNGGU && (
                                  <>
                                    <button 
                                      onClick={() => handleStartProcess(req.id)}
                                      disabled={processingReqId === req.id}
                                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-blue-500 transition-all ${isDarkMode ? 'hover:bg-blue-500/20' : 'hover:bg-white hover:shadow-sm'} ${processingReqId === req.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                                      title="Mulai Proses"
                                    >
                                      {processingReqId === req.id ? (
                                        <span className="material-symbols-outlined animate-spin text-xl">autorenew</span>
                                      ) : (
                                        <span className="material-symbols-outlined text-xl">play_arrow</span>
                                      )}
                                    </button>
                                    <button 
                                      onClick={() => { setRejectingReq(req); setRejectionReason(''); }}
                                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-rose-500 transition-all ${isDarkMode ? 'hover:bg-rose-500/20' : 'hover:bg-white hover:shadow-sm'}`}
                                      title="Tolak"
                                    >
                                      <span className="material-symbols-outlined text-xl">close</span>
                                    </button>
                                  </>
                                )}
                                {req.status === RequestStatus.DIPROSES && (
                                  <button 
                                    onClick={() => { setSelectedReq(req); setNewPassword(''); setShowWeakWarning(false); }}
                                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-emerald-500 transition-all ${isDarkMode ? 'hover:bg-emerald-500/20' : 'hover:bg-white hover:shadow-sm'}`}
                                    title="Reset Password"
                                  >
                                    <span className="material-symbols-outlined text-xl">key</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y transition-colors duration-300 divide-slate-100 dark:divide-slate-800">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={`skeleton-card-${i}`} className="p-4 animate-pulse space-y-3">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <div className="h-4 w-40 bg-slate-200 dark:bg-slate-800 rounded"></div>
                    <div className="h-3 w-24 bg-slate-100 dark:bg-slate-800 rounded"></div>
                  </div>
                  <div className="h-6 w-16 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
                </div>
                <div className="h-10 w-full bg-slate-100 dark:bg-slate-800 rounded-xl"></div>
              </div>
            ))
          ) : (
            filteredRequests.map((req) => (
              <div key={req.id} className={`p-4 space-y-4 transition-colors duration-300 ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0 pr-2">
                    <h3 className={`text-sm font-black uppercase tracking-tight truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                      {req.nama}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                      <span className="text-[10px] font-black font-mono text-slate-500">{req.nrp}</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">account_balance</span>
                        {req.kesatuan}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${
                      req.status === RequestStatus.MENUNGGU ? (isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600') :
                      req.status === RequestStatus.DIPROSES ? (isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600') : 
                      req.status === RequestStatus.DITOLAK ? (isDarkMode ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-600') :
                      (isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600')
                    }`}>
                      {getStatusLabel(req.status)}
                    </span>
                    <div className={`px-2 py-0.5 rounded-lg text-[7px] font-black uppercase tracking-widest border ${getPriorityColor(req.prioritas)}`}>
                      {req.prioritas || 'NORMAL'}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    onClick={() => { 
                      setViewingReq(req); 
                      setShowDetailPassword((isSuperAdmin || isAdminPolres) && req.status === RequestStatus.SELESAI); 
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 h-[44px] rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isDarkMode ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}`}
                  >
                    <span className="material-symbols-outlined text-lg">visibility</span>
                    DETAIL
                  </button>
                  
                  {isSuperAdmin && req.status === RequestStatus.MENUNGGU && (
                    <button 
                      onClick={() => handleStartProcess(req.id)}
                      disabled={processingReqId === req.id}
                      className={`flex items-center justify-center w-[44px] h-[44px] bg-blue-600 text-white rounded-xl transition-all ${processingReqId === req.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {processingReqId === req.id ? (
                        <span className="material-symbols-outlined animate-spin">autorenew</span>
                      ) : (
                        <span className="material-symbols-outlined">play_arrow</span>
                      )}
                    </button>
                  )}
                  
                  {isSuperAdmin && req.status === RequestStatus.DIPROSES && (
                    <button 
                      onClick={() => { setSelectedReq(req); setNewPassword(''); setShowWeakWarning(false); }}
                      className="flex items-center justify-center w-[44px] h-[44px] bg-emerald-600 text-white rounded-xl transition-all"
                    >
                      <span className="material-symbols-outlined">key</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          
          {filteredRequests.length === 0 && !isLoading && (
            <div className="p-12 text-center">
              <span className="material-symbols-outlined text-4xl opacity-20">database_off</span>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Tidak ada data</p>
            </div>
          )}
        </div>
      </div>

      {/* Pagination Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-10 pb-24 md:pb-12 print:hidden">
        <div className={`flex items-center gap-3 px-6 py-3 rounded-2xl border transition-all ${isDarkMode ? 'bg-slate-900/50 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className={`w-2 h-2 rounded-full animate-pulse ${isDarkMode ? 'bg-blue-500' : 'bg-blue-600'}`}></div>
          <div className={`text-[10px] font-black uppercase tracking-[0.15em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
            Menampilkan <span className={isDarkMode ? 'text-white' : 'text-slate-900'}>{totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}</span> - <span className={isDarkMode ? 'text-white' : 'text-slate-900'}>{Math.min(currentPage * itemsPerPage, totalItems)}</span> dari <span className={isDarkMode ? 'text-white' : 'text-slate-900'}>{totalItems}</span> data
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
            disabled={currentPage === 1 || totalItems === 0}
            className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition-all shadow-sm active:scale-90 ${currentPage === 1 || totalItems === 0 ? 'opacity-20 cursor-not-allowed' : (isDarkMode ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-white' : 'border-slate-100 bg-white hover:bg-slate-50 text-slate-900')}`}
          >
            <span className="material-symbols-outlined text-xl">chevron_left</span>
          </button>
          
          <div className="flex items-center gap-2">
            {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
              let pageNum;
              if (totalPages <= 5) pageNum = i + 1;
              else if (currentPage <= 3) pageNum = i + 1;
              else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
              else pageNum = currentPage - 2 + i;
              
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-12 h-12 rounded-2xl text-[11px] font-black transition-all shadow-sm border active:scale-90 ${currentPage === pageNum ? (isDarkMode ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' : 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200') : (isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800' : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50')}`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button 
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
            disabled={currentPage === totalPages || totalItems === 0}
            className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition-all shadow-sm active:scale-90 ${currentPage === totalPages || totalItems === 0 ? 'opacity-20 cursor-not-allowed' : (isDarkMode ? 'border-slate-800 bg-slate-900 hover:bg-slate-800 text-white' : 'border-slate-100 bg-white hover:bg-slate-50 text-slate-900')}`}
          >
            <span className="material-symbols-outlined text-xl">chevron_right</span>
          </button>
        </div>
      </div>

      {/* Floating Action Button for Mobile */}
      {isAnyAdmin && (
        <button 
          onClick={() => setIsManualModalOpen(true)}
          className="md:hidden fixed right-6 bottom-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center z-[100] active:scale-90 transition-transform"
        >
          <span className="material-symbols-outlined text-3xl">add</span>
        </button>
      )}

      {/* MOBILE FILTER MODAL */}
      <AnimatePresence>
        {isFilterModalOpen && (
          <div className="fixed inset-0 z-[300] md:hidden flex items-end print:hidden">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" 
              onClick={() => setIsFilterModalOpen(false)} 
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`relative w-full rounded-t-[2.5rem] p-8 shadow-2xl pb-safe ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}
            >
              <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-8" />
              
              <h3 className={`text-lg font-black uppercase tracking-tight mb-6 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Filter Data</h3>
              
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</label>
                  <select 
                    className={`w-full h-[52px] px-4 border rounded-2xl text-xs font-bold outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="Semua">Semua Status</option>
                    <option value={RequestStatus.MENUNGGU}>{isSuperAdmin ? 'Diterima' : 'Terkirim'}</option>
                    <option value={RequestStatus.DIPROSES}>Di Proses</option>
                    <option value={RequestStatus.SELESAI}>Selesai</option>
                    <option value={RequestStatus.DITOLAK}>Ditolak</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Prioritas</label>
                  <select 
                    className={`w-full h-[52px] px-4 border rounded-2xl text-xs font-bold outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value)}
                  >
                    <option value="Semua">Semua Prioritas</option>
                    <option value="NORMAL">Normal</option>
                    <option value="PENTING">Penting</option>
                    <option value="MENDESAK">Mendesak</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mulai</label>
                    <input 
                      type="date" 
                      className={`w-full h-[52px] px-4 border rounded-2xl text-xs font-bold outline-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
                      value={startDate} 
                      onChange={(e) => setStartDate(e.target.value)} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Selesai</label>
                    <input 
                      type="date" 
                      className={`w-full h-[52px] px-4 border rounded-2xl text-xs font-bold outline-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
                      value={endDate} 
                      onChange={(e) => setEndDate(e.target.value)} 
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => { handleApplyFilter(); setIsFilterModalOpen(false); }}
                    className="flex-1 h-[56px] bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-900/20"
                  >
                    TERAPKAN
                  </button>
                  <button 
                    onClick={() => { handleResetFilter(); setIsFilterModalOpen(false); }}
                    className={`px-6 h-[56px] border rounded-2xl font-black text-xs uppercase tracking-widest ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-white border-slate-200 text-slate-400'}`}
                  >
                    RESET
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL IMPORT EXCEL */}
      {isImportModalOpen && (
        <div 
          onClick={() => setIsImportModalOpen(false)}
          className="fixed inset-0 z-[220] flex items-end md:items-center justify-center md:p-6 bg-slate-900/70 backdrop-blur-xl animate-in fade-in duration-300"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className={`rounded-t-[2.5rem] md:rounded-[2.5rem] w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom md:zoom-in-95 transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}
          >
            <div className={`p-8 border-b flex items-center justify-between transition-colors duration-300 ${isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-emerald-50/30 border-emerald-100'}`}>
              <div className="flex items-center gap-4">
                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                    <span className="material-symbols-outlined text-3xl">upload_file</span>
                 </div>
                 <div>
                    <h3 className={`font-black text-lg uppercase tracking-tight leading-none ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Import Excel</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">Pilih file untuk diimport</p>
                 </div>
              </div>
              <button 
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsImportModalOpen(false);
                }}
                className={`p-3 rounded-full transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'}`}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-8 space-y-6">
               <div className={`p-4 rounded-2xl border flex items-start gap-4 transition-colors ${isDarkMode ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-amber-50 border-amber-100 text-amber-600'}`}>
                  <span className="material-symbols-outlined text-xl mt-0.5">warning</span>
                  <p className="text-[11px] font-bold leading-relaxed">
                     Pastikan Anda menggunakan template resmi agar format data sesuai dengan sistem.
                  </p>
               </div>

               <input 
                 type="file" 
                 ref={fileInputRef} 
                 className="hidden" 
                 accept=".xlsx, .xls" 
                 onChange={onFileChange} 
               />

               <div className="space-y-4">
                  {selectedFile ? (
                    <div className={`p-4 rounded-2xl border flex items-center justify-between animate-in zoom-in-95 duration-300 ${isDarkMode ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-emerald-50 border-emerald-100'}`}>
                       <div className="flex items-center gap-3 overflow-hidden">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-600'}`}>
                             <span className="material-symbols-outlined">description</span>
                          </div>
                          <div className="overflow-hidden">
                             <p className={`text-xs font-black truncate ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{selectedFile.name}</p>
                             <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">File Terpilih</p>
                          </div>
                       </div>
                       <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-emerald-500 animate-in fade-in duration-500">check_circle</span>
                          <button 
                            onClick={() => setSelectedFile(null)}
                            className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 transition-colors"
                          >
                             <span className="material-symbols-outlined text-lg">close</span>
                          </button>
                       </div>
                    </div>
                  ) : (
                    <div className={`p-8 border-2 border-dashed rounded-[2rem] flex flex-col items-center justify-center gap-3 transition-colors ${isDarkMode ? 'border-slate-800 bg-slate-800/20' : 'border-slate-100 bg-slate-50/50'}`}>
                       <span className="material-symbols-outlined text-4xl text-slate-300">cloud_upload</span>
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Belum ada file terpilih</p>
                    </div>
                  )}

                  <div className="flex flex-col gap-3">
                     <button 
                       type="button"
                       onClick={(e) => {
                         e.preventDefault();
                         e.stopPropagation();
                         fileInputRef.current?.click();
                       }}
                       className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.97] flex items-center justify-center gap-2 ${
                         selectedFile 
                           ? (isDarkMode ? 'bg-slate-800 text-white hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                           : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-900/20'
                       }`}
                     >
                       <span className="material-symbols-outlined text-lg">{selectedFile ? 'sync' : 'file_open'}</span>
                       {selectedFile ? 'GANTI FILE' : 'PILIH FILE EXCEL'}
                     </button>

                     {selectedFile && (
                       <button 
                         type="button"
                         disabled={isImporting}
                         onClick={(e) => {
                           e.preventDefault();
                           e.stopPropagation();
                           handleUploadExcel();
                         }}
                         className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/20 active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                         {isImporting ? (
                           <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                         ) : (
                           <span className="material-symbols-outlined text-lg">publish</span>
                         )}
                         {isImporting ? 'MEMPROSES...' : 'UNGGAH DATA SEKARANG'}
                       </button>
                     )}
                  </div>
               </div>

               <div className="relative py-2">
                  <div className={`absolute inset-0 flex items-center ${isDarkMode ? 'opacity-20' : 'opacity-10'}`}>
                     <div className="w-full border-t border-slate-400"></div>
                  </div>
                  <div className="relative flex justify-center">
                     <span className={`px-4 text-[9px] font-black uppercase tracking-[0.3em] ${isDarkMode ? 'bg-slate-900 text-slate-500' : 'bg-white text-slate-400'}`}>Atau</span>
                  </div>
               </div>

               <div className="flex flex-col gap-3">
                  <button 
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      downloadTemplate();
                    }}
                    className={`w-full py-4 border-2 rounded-2xl font-black text-xs uppercase tracking-widest transition-all active:scale-[0.97] flex items-center justify-center gap-2 ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700' : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-lg">download</span>
                    UNDUH TEMPLATE FORM
                  </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ERROR IMPORT */}
      {importErrors.length > 0 && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-xl animate-in fade-in duration-300">
          <div className={`rounded-[2.5rem] w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
            <div className={`p-8 border-b flex items-center justify-between transition-colors duration-300 ${isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-rose-50/30 border-rose-100'}`}>
              <div className="flex items-center gap-4">
                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-600'}`}>
                    <span className="material-symbols-outlined text-3xl">error</span>
                 </div>
                 <div>
                    <h3 className={`font-black text-lg uppercase tracking-tight leading-none ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Konflik Data Import</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">{importErrors.length} baris bermasalah ditemukan</p>
                 </div>
              </div>
              <button onClick={() => setImportErrors([])} className={`p-3 rounded-full transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'}`}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="p-8 max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
               <div className="space-y-3">
                  {importErrors.map((err, idx) => (
                    <div key={idx} className={`p-4 rounded-2xl border flex items-start gap-4 transition-colors ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                       <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center font-black text-xs">
                          {err.row}
                       </div>
                       <div className="flex-1">
                          <p className={`text-[10px] font-black uppercase tracking-widest ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>Baris {err.row}: NRP {err.nrp}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-1">
                             Input: <span className="text-rose-500">{err.nama}</span> | Database: <span className="text-emerald-500">{err.existingNama}</span>
                          </p>
                       </div>
                    </div>
                  ))}
               </div>
            </div>

            <div className="p-8 border-t border-slate-100 dark:border-slate-800 flex justify-end">
               <button 
                 onClick={() => setImportErrors([])}
                 className="px-10 py-4 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-2xl font-black text-xs uppercase tracking-widest hover:opacity-90 transition-all"
               >
                 Tutup & Perbaiki File
               </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TOLAK (REJECT) */}
      {rejectingReq && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-xl animate-in fade-in duration-300">
           <div className={`rounded-[3rem] w-full max-w-lg shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
              <div className="p-10 border-b flex items-center justify-between">
                 <div>
                    <h3 className={`text-2xl font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Tolak Permohonan</h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-3">PERSONEL: {rejectingReq.nama}</p>
                 </div>
                 <button onClick={() => setRejectingReq(null)} className="p-3 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-all">
                    <span className="material-symbols-outlined">close</span>
                 </button>
              </div>

              <div className="p-10 space-y-8">
                 <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Alasan Penolakan</label>
                    <textarea 
                      className={`w-full p-6 border rounded-3xl text-sm font-bold min-h-[150px] outline-none transition-all focus:ring-4 focus:ring-rose-500/10 ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
                      placeholder="Tuliskan alasan penolakan di sini..."
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                    ></textarea>
                    <p className="text-[10px] text-slate-400 font-bold italic">Alasan ini akan dikirimkan ke email personel yang bersangkutan.</p>
                 </div>

                 <div className="flex gap-4">
                    <button 
                      onClick={handleReject}
                      disabled={isRejecting}
                      className={`flex-1 py-5 bg-rose-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-xl shadow-rose-900/20 flex items-center justify-center gap-2 ${isRejecting ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      {isRejecting ? (
                        <>
                          <span className="material-symbols-outlined animate-spin text-sm">autorenew</span>
                          Memproses...
                        </>
                      ) : (
                        'Konfirmasi Tolak'
                      )}
                    </button>
                    <button 
                      onClick={() => setRejectingReq(null)}
                      className={`flex-1 py-5 border rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                    >
                      Batal
                    </button>
                 </div>
              </div>
           </div>
        </div>
      )}

      {/* MODAL DETAIL */}
      {viewingReq && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-xl animate-in fade-in duration-300">
           <div className={`rounded-[3rem] w-full max-w-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
              <div className={`p-10 border-b flex items-center justify-between transition-colors duration-300 ${isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-50/30 border-slate-50'}`}>
                 <div>
                    <h3 className={`text-2xl font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Rincian Permohonan</h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-3">ID TIKET: {viewingReq.id}</p>
                 </div>
                 <button onClick={() => setViewingReq(null)} className={`p-3 rounded-full transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'}`}>
                    <span className="material-symbols-outlined">close</span>
                 </button>
              </div>

              <div className="p-10 space-y-10 overflow-y-auto max-h-[70vh]">
                 <div className="grid grid-cols-2 gap-8">
                    <div>
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Status Saat Ini</p>
                       <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                          viewingReq.status === RequestStatus.MENUNGGU ? (isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600') :
                          viewingReq.status === RequestStatus.DIPROSES ? (isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600') : 
                          viewingReq.status === RequestStatus.DITOLAK ? (isDarkMode ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-600') :
                          (isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600')
                       }`}>
                          {getStatusLabel(viewingReq.status)}
                       </span>
                    </div>
                    <div>
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Waktu Pengajuan</p>
                       <p className={`text-sm font-black ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{new Date(viewingReq.createdAt).toLocaleString('id-ID')}</p>
                    </div>
                 </div>

                 <div className="space-y-6">
                    <div className={`p-6 rounded-[2rem] border flex items-center gap-6 transition-colors duration-300 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                       <div className={`w-16 h-16 rounded-[1.5rem] shadow-sm flex items-center justify-center border transition-colors duration-300 ${isDarkMode ? 'bg-slate-700 border-slate-600 text-slate-400' : 'bg-white border-slate-100 text-slate-400'}`}>
                          <span className="material-symbols-outlined text-3xl">person</span>
                       </div>
                       <div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nama Lengkap</p>
                          <h4 className={`text-xl font-black uppercase leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{viewingReq.nama}</h4>
                          <p className="text-xs font-bold text-slate-500 mt-2">{viewingReq.pangkat} / {viewingReq.nrp}</p>
                       </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                       <div className={`p-5 border rounded-2xl transition-colors duration-300 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Jabatan</p>
                          <p className={`text-xs font-black ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{viewingReq.jabatan}</p>
                       </div>
                       <div className={`p-5 border rounded-2xl transition-colors duration-300 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-100'}`}>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Kesatuan</p>
                          <p className="text-xs font-black text-blue-600 uppercase">{viewingReq.kesatuan}</p>
                       </div>
                    </div>

                    <div className={`p-6 rounded-2xl space-y-3 transition-colors duration-300 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Catatan / Alasan</p>
                       <p className={`text-sm font-bold italic leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>"{viewingReq.catatan || 'Tidak ada catatan tambahan yang dilampirkan.'}"</p>
                    </div>

                    {(viewingReq.status === RequestStatus.SELESAI || String(viewingReq.status).toUpperCase() === 'SELESAI') && (
                       <div className={`p-6 rounded-2xl space-y-3 transition-colors duration-300 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PASSWORD BARU</p>
                          <div className="relative flex items-center justify-between">
                             <input 
                                type="text" 
                                readOnly 
                                className={`bg-transparent border-none p-0 text-sm font-bold outline-none flex-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}
                                 value={showDetailPassword 
                                    ? (viewingReq.reset_password || '') 
                                    : '••••••••'}
                             />
                             <div className="flex items-center gap-2 ml-4">
                                <button 
                                   type="button"
                                   onClick={() => setShowDetailPassword(!showDetailPassword)}
                                   className={`p-2 rounded-xl transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-200'}`}
                                   title={showDetailPassword ? "Sembunyikan" : "Tampilkan"}
                                >
                                   <span className="material-symbols-outlined text-lg">{showDetailPassword ? 'visibility' : 'visibility_off'}</span>
                                </button>
                                <button 
                                   type="button"
                                   onClick={() => handleCopyPassword(viewingReq.reset_password || '')}
                                   className={`p-2 rounded-xl transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-700' : 'text-slate-500 hover:bg-slate-200'}`}
                                   title="Salin Password"
                                >
                                   <span className="material-symbols-outlined text-lg">content_copy</span>
                                </button>
                             </div>
                          </div>
                       </div>
                    )}

                    {viewingReq.dokumen_kta && (
                      <div className={`p-6 rounded-2xl space-y-3 transition-colors duration-300 ${isDarkMode ? 'bg-slate-800' : 'bg-slate-50'}`}>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dokumen KTA</p>
                          <a 
                            href={`/api/download/kta/${viewingReq.dokumen_kta}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-[10px] font-black text-blue-500 uppercase hover:underline"
                          >
                            <span className="material-symbols-outlined text-sm">download</span>
                            Download Full
                          </a>
                        </div>
                        <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-900 flex items-center justify-center min-h-[200px]">
                          <img 
                            src={`/api/download/kta/${viewingReq.dokumen_kta}`} 
                            alt="KTA" 
                            className="max-w-full h-auto" 
                            onError={(e) => {
                              // Fallback if not found or not a filename
                              if (!viewingReq.dokumen_kta?.startsWith('data:')) {
                                (e.target as HTMLImageElement).src = 'https://placehold.co/400x250?text=Dokumen+Tidak+Tersedia';
                              }
                            }}
                          />
                        </div>
                      </div>
                    )}
                 </div>
              </div>

              <div className="p-10 pt-0">
                 <button onClick={() => setViewingReq(null)} className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest transition-all shadow-xl ${isDarkMode ? 'bg-white text-slate-900 hover:bg-slate-200 shadow-white/5' : 'bg-slate-900 text-white hover:bg-slate-800 shadow-slate-200'}`}>
                    Tutup Detail
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* MODAL INPUT MANUAL (KHUSUS ADMIN) */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-xl animate-in fade-in duration-300">
          <div className={`rounded-[3rem] w-full max-w-xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
            <div className={`p-10 border-b flex items-center justify-between transition-colors duration-300 ${isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-50/30 border-slate-100'}`}>
              <div className="flex items-center gap-4">
                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                    <span className="material-symbols-outlined text-3xl">person_add</span>
                 </div>
                 <div>
                    <h3 className={`font-black text-xl uppercase tracking-tight leading-none ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Input Pengajuan Manual</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">Buat tiket reset password baru</p>
                 </div>
              </div>
              <button onClick={() => setIsManualModalOpen(false)} className={`p-3 rounded-full transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'}`}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <form onSubmit={handleManualSubmit} className="p-10 space-y-8 overflow-y-auto max-h-[calc(100vh-250px)] scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
               <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nama Personel</label>
                    <input 
                      type="text" 
                      className={`w-full px-6 py-4 border rounded-2xl text-sm font-bold transition-all outline-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-200 focus:bg-white'}`} 
                      placeholder="Nama Lengkap"
                      value={manualForm.nama}
                      onChange={(e) => setManualForm({...manualForm, nama: e.target.value})}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">NRP / NIP</label>
                    <input 
                      type="text" 
                      className={`w-full px-6 py-4 border rounded-2xl text-sm font-bold transition-all outline-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-200 focus:bg-white'}`} 
                      placeholder="8 Digit NRP"
                      value={manualForm.nrp}
                      onChange={(e) => setManualForm({...manualForm, nrp: e.target.value})}
                      onBlur={async () => {
                        const existingNama = await validateNRP(manualForm.nrp, manualForm.nama);
                        if (existingNama) {
                          setNrpConflict({ nrp: manualForm.nrp, existingNama });
                        }
                      }}
                      required
                    />
                  </div>
               </div>
               {nrpConflict && (
                 <div className={`p-4 rounded-2xl border flex items-start gap-4 animate-in slide-in-from-top-2 duration-300 ${isDarkMode ? 'bg-rose-500/10 border-rose-500/30' : 'bg-rose-50 border-rose-100'}`}>
                    <span className="material-symbols-outlined text-rose-500 mt-0.5">warning</span>
                    <div className="flex-1">
                       <p className={`text-xs font-black uppercase tracking-tight ${isDarkMode ? 'text-rose-400' : 'text-rose-600'}`}>Konflik Data Personel</p>
                       <p className={`text-[10px] font-bold mt-1 ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                          NRP <span className="font-black text-rose-500">{nrpConflict.nrp}</span> sudah terdaftar atas nama <span className="font-black text-rose-500">{nrpConflict.existingNama}</span>. Silakan periksa kembali kesesuaian data.
                       </p>
                       <button 
                         type="button"
                         onClick={() => setNrpConflict(null)}
                         className="mt-3 text-[9px] font-black uppercase tracking-widest text-rose-500 hover:underline"
                       >
                         Saya Mengerti
                       </button>
                    </div>
                 </div>
               )}
               <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Pangkat</label>
                    <input 
                      type="text" 
                      className={`w-full px-6 py-4 border rounded-2xl text-sm font-bold transition-all outline-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-200 focus:bg-white'}`} 
                      placeholder="Contoh: Briptu"
                      value={manualForm.pangkat}
                      onChange={(e) => setManualForm({...manualForm, pangkat: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Jabatan</label>
                    <input 
                      type="text" 
                      className={`w-full px-6 py-4 border rounded-2xl text-sm font-bold transition-all outline-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-200 focus:bg-white'}`} 
                      placeholder="Unit Kerja"
                      value={manualForm.jabatan}
                      onChange={(e) => setManualForm({...manualForm, jabatan: e.target.value})}
                    />
                  </div>
               </div>
               <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Kesatuan</label>
                  <input 
                    type="text" 
                    className={`w-full px-6 py-4 border rounded-2xl text-sm font-black transition-all outline-none ${
                      !isSuperAdmin 
                        ? (isDarkMode ? 'bg-slate-800/50 border-slate-800 text-slate-500' : 'bg-slate-100 border-slate-100 text-slate-500') 
                        : (isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-200 focus:bg-white')
                    }`}
                    value={manualForm.kesatuan}
                    onChange={(e) => isSuperAdmin && setManualForm({...manualForm, kesatuan: e.target.value})}
                    readOnly={!isSuperAdmin}
                    required
                  />
                  {!isSuperAdmin && <p className="text-[9px] font-bold text-blue-500 uppercase mt-2 italic px-1">* Terkunci: Hanya untuk unit {currentUser.kesatuan}</p>}
               </div>
               <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Prioritas</label>
                  <select
                    className={`w-full px-6 py-4 border rounded-2xl text-sm font-bold transition-all outline-none appearance-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500' : 'bg-white border-slate-200 focus:border-blue-500'}`}
                    value={manualForm.prioritas}
                    onChange={(e) => setManualForm({...manualForm, prioritas: e.target.value})}
                    required
                  >
                    <option value="Bukan Prioritas">Bukan Prioritas</option>
                    <option value="Prioritas Mendesak">Prioritas Mendesak</option>
                  </select>
               </div>
               <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Keterangan / Catatan</label>
                  <textarea 
                    className={`w-full px-6 py-4 border rounded-2xl text-sm font-bold h-32 resize-none outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500' : 'bg-white border-slate-200 focus:border-blue-500'}`}
                    placeholder="Contoh: Permohonan langsung di loket..."
                    value={manualForm.catatan}
                    onChange={(e) => setManualForm({...manualForm, catatan: e.target.value})}
                  />
               </div>
               <div className="pt-8 flex items-center justify-end gap-4 border-t border-slate-100 dark:border-slate-800">
                  <button 
                    type="button" 
                    onClick={() => setIsManualModalOpen(false)}
                    className={`px-8 py-4 rounded-2xl font-black transition-all text-xs uppercase tracking-widest ${isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    Batal
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmittingManual}
                    className={`px-10 py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 shadow-2xl shadow-blue-200/20 transition-all active:scale-95 flex items-center gap-2 ${isSubmittingManual ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isSubmittingManual ? (
                      <>
                        <span className="material-symbols-outlined animate-spin text-sm">autorenew</span>
                        Memproses...
                      </>
                    ) : (
                      'Kirim Pengajuan'
                    )}
                  </button>
               </div>
            </form>
          </div>
        </div>
      )}

      {selectedReq && isSuperAdmin && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center p-6 bg-slate-900/70 backdrop-blur-xl animate-in fade-in duration-300">
          <div className={`rounded-[3rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
            <div className={`p-10 border-b flex items-center justify-between transition-colors duration-300 ${isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-50/30 border-slate-50'}`}>
              <div className="flex items-center gap-4">
                 <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                    <span className="material-symbols-outlined text-3xl">key</span>
                 </div>
                 <div>
                    <h3 className={`font-black text-xl uppercase tracking-tight leading-none ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Eksekusi Reset</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">Update password personel</p>
                 </div>
              </div>
              <button onClick={() => { setSelectedReq(null); setShowWeakWarning(false); }} className={`p-3 rounded-full transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-400 hover:bg-rose-50 hover:text-rose-500'}`}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-10 space-y-8 overflow-y-auto max-h-[calc(100vh-200px)] scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
              <div className={`p-6 rounded-[2rem] border space-y-2 text-center transition-colors duration-300 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Personel</div>
                <div className={`text-lg font-black uppercase ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{selectedReq.nama}</div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest">{selectedReq.nrp} — {selectedReq.kesatuan}</div>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Password Baru</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      className={`w-full px-8 py-5 border-2 rounded-3xl font-black placeholder:text-slate-200 focus:outline-none transition-all text-center text-xl tracking-widest ${
                        showWeakWarning 
                          ? 'border-amber-400' 
                          : (isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-blue-500' : 'bg-white border-slate-100 text-slate-800 focus:border-blue-500')
                      }`}
                      placeholder="Contoh: Polri#2026"
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (showWeakWarning) setShowWeakWarning(false);
                      }}
                      autoFocus
                    />
                    {newPassword && (
                      <div className="mt-4 px-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kekuatan Password</span>
                          <span className={`text-[10px] font-black uppercase ${
                            passwordStrength <= 25 ? 'text-rose-500' :
                            passwordStrength <= 50 ? 'text-amber-500' :
                            passwordStrength <= 75 ? 'text-blue-500' : 'text-emerald-500'
                          }`}>
                            {passwordStrength <= 25 ? 'Sangat Lemah' :
                             passwordStrength <= 50 ? 'Lemah' :
                             passwordStrength <= 75 ? 'Kuat' : 'Sangat Kuat'}
                          </span>
                        </div>
                        <div className={`h-1.5 w-full rounded-full overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                          <div 
                            className={`h-full transition-all duration-500 ${
                              passwordStrength <= 25 ? 'bg-rose-500' :
                              passwordStrength <= 50 ? 'bg-amber-500' :
                              passwordStrength <= 75 ? 'bg-blue-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${passwordStrength}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* WARNING PASSWORD LEMAH */}
                {showWeakWarning && (
                  <div className={`p-5 border rounded-2xl animate-in fade-in zoom-in-95 ${isDarkMode ? 'bg-amber-900/20 border-amber-900/50' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-amber-500 text-xl">warning</span>
                      <div>
                        <p className={`text-xs font-black uppercase tracking-tight ${isDarkMode ? 'text-amber-400' : 'text-amber-800'}`}>Password Terlalu Lemah</p>
                        <p className={`text-[10px] font-bold mt-1 leading-relaxed ${isDarkMode ? 'text-amber-500/80' : 'text-amber-600'}`}>
                          Password minimal 8 karakter dan mengandung kombinasi angka serta simbol untuk keamanan maksimal.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button 
                        onClick={() => executeReset(true)}
                        className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-600 transition-all"
                      >
                        Lanjut
                      </button>
                      <button 
                        onClick={() => setShowWeakWarning(false)}
                        className={`flex-1 py-2.5 border rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isDarkMode ? 'bg-slate-800 border-amber-900/50 text-amber-400 hover:bg-slate-700' : 'bg-white border-amber-200 text-amber-600 hover:bg-amber-100'}`}
                      >
                        Perbaiki
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-8 flex items-center justify-end gap-4 border-t border-slate-100 dark:border-slate-800">
                <button 
                  onClick={() => { setSelectedReq(null); setShowWeakWarning(false); }}
                  className={`px-8 py-4 rounded-2xl font-black transition-all text-xs uppercase tracking-widest ${isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  Batal
                </button>
                {!showWeakWarning && (
                  <button 
                    onClick={() => executeReset(false)}
                    disabled={isExecutingReset}
                    className={`px-10 py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 shadow-2xl shadow-emerald-200/20 transition-all active:scale-95 flex items-center gap-2 ${isExecutingReset ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    {isExecutingReset ? (
                      <>
                        <span className="material-symbols-outlined animate-spin text-xl">autorenew</span>
                        Memproses...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-xl">send</span>
                        Selesaikan Reset
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Header (Super Admin Only) */}
      {isEditHeaderModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className={`w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}>
            <div className="p-8 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className={`text-xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Edit Judul Halaman</h3>
              <button onClick={() => setIsEditHeaderModalOpen(false)} className="p-2 text-slate-400 hover:text-rose-500 transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Judul Utama</label>
                <input 
                  type="text"
                  value={headerForm.title}
                  onChange={(e) => setHeaderForm(prev => ({ ...prev, title: e.target.value }))}
                  className={`w-full px-5 py-4 rounded-2xl border-2 font-bold transition-all focus:ring-4 focus:ring-sky-500/10 outline-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-sky-500' : 'bg-slate-50 border-slate-100 text-slate-900 focus:border-blue-500'}`}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sub-Judul</label>
                <textarea 
                  value={headerForm.subtitle}
                  onChange={(e) => setHeaderForm(prev => ({ ...prev, subtitle: e.target.value }))}
                  rows={3}
                  className={`w-full px-5 py-4 rounded-2xl border-2 font-bold transition-all focus:ring-4 focus:ring-sky-500/10 outline-none resize-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-sky-500' : 'bg-slate-50 border-slate-100 text-slate-900 focus:border-blue-500'}`}
                />
              </div>
              <button 
                onClick={handleSaveHeader}
                disabled={isSavingHeader}
                className={`w-full py-5 bg-sky-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-sky-700 transition-all shadow-xl shadow-sky-900/20 flex items-center justify-center gap-2 ${isSavingHeader ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                {isSavingHeader ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">autorenew</span>
                    Memproses...
                  </>
                ) : (
                  'Simpan Perubahan'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media print {
          @page { size: landscape; margin: 1cm; }
          body { background: white !important; color: black !important; }
          main { padding: 0 !important; margin: 0 !important; max-width: 100% !important; }
          table { width: 100% !important; border-collapse: collapse !important; font-size: 8pt !important; }
          th, td { border: 0.5pt solid #cbd5e1 !important; padding: 10pt !important; vertical-align: middle !important; }
          th { background-color: #f8fafc !important; font-weight: 900 !important; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:table-cell { display: table-cell !important; }
          .print\\:divide-slate-200 > * + * { border-top-width: 1pt !important; border-color: #e2e8f0 !important; }
          .print\\:divide-slate-200 tr { border-bottom: 0.5pt solid #cbd5e1 !important; }
        }
      `}</style>
    </main>
  );
};

export default ResetRequests;
