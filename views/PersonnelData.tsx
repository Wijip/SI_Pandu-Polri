
import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { useDebounce } from '../src/hooks/useDebounce';
import { Personnel, UserRole, LogEntry, SiteSettings } from '../types';

interface PersonnelDataProps {
  personnel: Personnel[];
  setPersonnel: React.Dispatch<React.SetStateAction<Personnel[]>>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  addLog?: (aktivitas: LogEntry['aktivitas'], keterangan: string) => void;
  siteSettings: SiteSettings;
  currentUser: Personnel;
}

const PersonnelData: React.FC<PersonnelDataProps> = ({ personnel, setPersonnel, showToast, addLog, siteSettings, currentUser }) => {
  const isDarkMode = siteSettings.darkMode;
  const isSuperAdmin = currentUser.role === UserRole.SUPERADMIN;
  const isAdminPolres = currentUser.role === UserRole.ADMIN;
  const [showImportDropdown, setShowImportDropdown] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<'excel' | 'csv' | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowImportDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter personnel based on role
  const visiblePersonnel = useMemo(() => {
    if (isSuperAdmin) return personnel;
    if (isAdminPolres) return personnel.filter(p => p.role === UserRole.USER);
    return [];
  }, [personnel, isSuperAdmin, isAdminPolres]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [allUnits, setAllUnits] = useState<{id: number, nama: string, tipe: string}[]>([]);
  const [isFilterUnitOpen, setIsFilterUnitOpen] = useState(false);
  const [filterUnitSearch, setFilterUnitSearch] = useState('');
  const filterUnitRef = useRef<HTMLDivElement>(null);

  const [isModalUnitOpen, setIsModalUnitOpen] = useState(false);
  const [modalUnitSearch, setModalUnitSearch] = useState('');
  const modalUnitRef = useRef<HTMLDivElement>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Close unit dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterUnitRef.current && !filterUnitRef.current.contains(event.target as Node)) {
        setIsFilterUnitOpen(false);
      }
      if (modalUnitRef.current && !modalUnitRef.current.contains(event.target as Node)) {
        setIsModalUnitOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredFilterUnits = useMemo(() => {
    if (!filterUnitSearch) return allUnits;
    return allUnits.filter(u => u.nama.toLowerCase().includes(filterUnitSearch.toLowerCase()));
  }, [allUnits, filterUnitSearch]);

  const filteredModalUnits = useMemo(() => {
    if (!modalUnitSearch) return allUnits;
    return allUnits.filter(u => u.nama.toLowerCase().includes(modalUnitSearch.toLowerCase()));
  }, [allUnits, modalUnitSearch]);

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const debouncedSearch = useDebounce(searchTerm, 500);

  const fetchUnits = async () => {
    try {
      const res = await fetch('/api/units', { credentials: 'include' });
      const result = await res.json();
      if (result.success) {
        setAllUnits(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch units:', error);
    }
  };

  useEffect(() => {
    fetchUnits();
  }, []);

  // Sync debounced search to active search for "automatic" feel, but allow manual trigger
  useEffect(() => {
    setActiveSearch(debouncedSearch);
  }, [debouncedSearch]);

  // Initial form state - Kosong untuk data baru (hanya placeholder)
  const initialForm: Partial<Personnel> = {
    nama: '',
    nrp: '',
    pangkat: '',
    jabatan: '',
    kesatuan: '',
    email: '',
    role: UserRole.USER,
    status: 'Aktif'
  };

  const [formData, setFormData] = useState<Partial<Personnel>>(initialForm);
  const [filterRole, setFilterRole] = useState<string>('ALL');
  const [filterKesatuan, setFilterKesatuan] = useState<string>('ALL');
  const [sortConfig, setSortConfig] = useState<{ key: keyof Personnel; direction: 'asc' | 'desc' } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const fetchPersonnel = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        search: activeSearch,
        role: filterRole,
        kesatuan: filterKesatuan
      });
      const res = await fetch(`/api/personnel?${params.toString()}`, { credentials: 'include' });
      const result = await res.json();
      setPersonnel(result.data);
      setTotalItems(result.total);
    } catch (error) {
      console.error('Failed to fetch personnel:', error);
      showToast('Gagal mengambil data personel', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPersonnel();
  }, [currentPage, itemsPerPage, activeSearch, filterRole, filterKesatuan]);

  const stats = useMemo(() => {
    return {
      total: totalItems,
      superAdmin: personnel.filter(p => p.role === UserRole.SUPERADMIN).length, // This is only for current page, maybe not ideal
      admin: personnel.filter(p => p.role === UserRole.ADMIN).length,
      user: personnel.filter(p => p.role === UserRole.USER).length,
      active: personnel.filter(p => p.status === 'Aktif').length
    };
  }, [personnel, totalItems]);

  const handleImport = (type: 'excel' | 'csv') => {
    setImportType(type);
    setShowImportDropdown(false);
    if (fileInputRef.current) {
      fileInputRef.current.accept = type === 'excel' ? '.xlsx, .xls' : '.csv';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const data = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (data.length === 0) {
          showToast('File kosong atau format tidak sesuai', 'error');
          return;
        }

        const newPersonnel: Personnel[] = [];
        let skippedCount = 0;

        data.forEach((row, index) => {
          const nrp = String(row.NRP || row.nrp || '').trim();
          const nama = String(row.Nama || row.nama || '').trim();
          
          if (!nrp || !nama) {
            skippedCount++;
            return;
          }

          // Check if NRP already exists in current personnel
          if (personnel.some(p => p.nrp === nrp) || newPersonnel.some(p => p.nrp === nrp)) {
            skippedCount++;
            return;
          }

          // For Admin Polres, restrict to their unit
          const kesatuan = isAdminPolres ? currentUser.kesatuan : (String(row.Kesatuan || row.kesatuan || '').trim() || 'Polda Jatim');
          
          newPersonnel.push({
            id: `IMP-${Date.now()}-${index}`,
            nama,
            nrp,
            pangkat: String(row.Pangkat || row.pangkat || '').trim(),
            jabatan: String(row.Jabatan || row.jabatan || '').trim(),
            kesatuan,
            email: String(row.Email || row.email || '').trim() || `${nrp}@polri.go.id`,
            emailAlias: String(row.EmailAlias || row.email_alias || '').trim(),
            passwordPlain: String(row.Password || row.password || '').trim() || 'pCtAi9T2221G',
            role: (String(row.Role || row.role || '').toUpperCase() as UserRole) || UserRole.USER,
            status: 'Aktif'
          });
        });

        if (newPersonnel.length > 0) {
          // Save to API using Bulk Insert
          fetch('/api/personnel/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(newPersonnel)
          }).then(async (res) => {
            if (!res.ok) throw new Error('Bulk API failed');
            const result = await res.json();
            if (result.success) {
              setPersonnel(prev => [...prev, ...newPersonnel]);
              showToast(`Berhasil mengimpor ${newPersonnel.length} data.${skippedCount > 0 ? ` (${skippedCount} data dilewati)` : ''}`);
              addLog?.('Import Data', `Mengimpor ${newPersonnel.length} data personel via ${importType?.toUpperCase()}`);
            } else {
              throw new Error(result.message || 'Gagal import');
            }
          }).catch(err => {
            console.error('Failed to import personnel:', err);
            showToast('Gagal menyimpan data ke server', 'error');
          });
        } else {
          showToast('Tidak ada data baru yang valid untuk diimpor', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('Gagal memproses file. Pastikan format benar.', 'error');
      }
      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    if (importType === 'excel') {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsText(file);
    }
  };

  // State untuk Custom Delete/Deactivate Flow
  const [actionTarget, setActionTarget] = useState<Personnel | null>(null);
  const [actionStep, setActionStep] = useState<'choice' | 'confirm'>('choice');
  const [actionType, setActionType] = useState<'delete' | 'deactivate' | null>(null);

  const [selectedPersonnel, setSelectedPersonnel] = useState<Personnel | null>(null);

  const kesatuanList = useMemo(() => {
    if (allUnits.length > 0) {
      return allUnits.map(u => u.nama);
    }
    const list = Array.from(new Set(visiblePersonnel.map(p => p.kesatuan))).sort();
    return list;
  }, [visiblePersonnel, allUnits]);

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeSearch, filterRole, filterKesatuan]);

  const requestSort = (key: keyof Personnel) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const getSortIcon = (key: keyof Personnel) => {
    if (!sortConfig || sortConfig.key !== key) {
      return <span className="material-symbols-outlined text-[14px] opacity-30">unfold_more</span>;
    }
    return sortConfig.direction === 'asc' 
      ? <span className="material-symbols-outlined text-[14px] text-sky-500">arrow_upward</span>
      : <span className="material-symbols-outlined text-[14px] text-sky-500">arrow_downward</span>;
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setActiveSearch('');
    setFilterRole('ALL');
    setFilterKesatuan('ALL');
    setSortConfig(null);
    setCurrentPage(1);
    setSelectedPersonnel(null);
  };

  const handleManualSearch = () => {
    setActiveSearch(searchTerm);
  };

  const handleEdit = (p: Personnel) => {
    setEditingId(p.id);
    setFormError(null);
    setFormData(p);
    setIsModalOpen(true);
  };

  const handleDelete = (id: string) => {
    const person = personnel.find(p => p.id === id);
    if (person) {
      setActionTarget(person);
      setActionStep('choice');
      setActionType(null);
    }
  };

  const executeAction = async () => {
    if (!actionTarget || !actionType) return;

    try {
      if (actionType === 'delete') {
        const res = await fetch(`/api/personnel/${actionTarget.id}`, { method: 'DELETE', credentials: 'include' });
        if (!res.ok) throw new Error('Failed to delete');
        
        setPersonnel(prev => prev.filter(p => p.id !== actionTarget.id));
        showToast('Data personel berhasil dihapus.');
        addLog?.('Hapus Data', `Menghapus data personel: ${actionTarget.nama} (NRP: ${actionTarget.nrp})`);
      } else {
        const updatedPerson = { ...actionTarget, status: 'Nonaktif' as const };
        const res = await fetch(`/api/personnel/${actionTarget.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updatedPerson)
        });
        if (!res.ok) throw new Error('Failed to update');

        setPersonnel(prev => prev.map(p => p.id === actionTarget.id ? updatedPerson : p));
        showToast('Status personel berhasil diubah menjadi Nonaktif.');
        addLog?.('Update Data', `Menonaktifkan personel: ${actionTarget.nama} (NRP: ${actionTarget.nrp})`);
      }
    } catch (error) {
      console.error('Action failed:', error);
      showToast('Gagal memproses permintaan ke server', 'error');
    }

    setActionTarget(null);
    setActionType(null);
    setActionStep('choice');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.nama || !formData.nrp) return showToast('Nama dan NRP wajib diisi', 'error');

    const trimmedNrp = formData.nrp.trim();
    const isNrpExists = personnel.some(p => p.nrp === trimmedNrp && p.id !== editingId);
    if (isNrpExists) {
      return showToast(`Peringatan: NRP/NIP ${trimmedNrp} sudah terdaftar di dalam sistem! Silakan gunakan NRP lain atau periksa kembali data personel.`, 'error');
    }

    try {
      setFormError(null);
      if (editingId) {
        const sanitizedData = {
          ...formData,
          nama: formData.nama?.trim(),
          nrp: formData.nrp?.trim(),
          pangkat: formData.pangkat?.trim(),
          jabatan: formData.jabatan?.trim(),
          kesatuan: formData.kesatuan?.trim(),
          email: formData.email?.trim()
        };
        
        const res = await fetch(`/api/personnel/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(sanitizedData)
        });
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to update');
        }

        setPersonnel(prev => prev.map(p => p.id === editingId ? { ...p, ...sanitizedData as Personnel } : p));
        showToast('Data berhasil diperbarui');
        addLog?.('Update Data', `Memperbarui data personel: ${formData.nama} (NRP: ${formData.nrp})`);
      } else {
        const defaultPassword = formData.role === UserRole.SUPERADMIN ? 'superadmin!123' : formData.role === UserRole.ADMIN ? 'admin!1234' : 'user!1234';
        
        const newPerson: Personnel = {
          ...(formData as Personnel),
          nama: formData.nama?.trim() || '',
          nrp: formData.nrp?.trim() || '',
          pangkat: formData.pangkat?.trim() || '',
          jabatan: formData.jabatan?.trim() || '',
          kesatuan: formData.kesatuan?.trim() || '',
          email: formData.email?.trim() || '',
          id: `P-${Date.now()}`,
          password: defaultPassword
        };
        
        const res = await fetch('/api/personnel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(newPerson)
        });
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to create');
        }

        setPersonnel(prev => [newPerson, ...prev]);
        showToast(`Personel baru ditambahkan. Password default: ${defaultPassword}`);
        addLog?.('Update Data', `Menambahkan personel baru: ${newPerson.nama} (NRP: ${newPerson.nrp})`);
      }
      setIsModalOpen(false);
      setEditingId(null);
      setFormData(initialForm);
    } catch (error: any) {
      console.error('Save failed:', error);
      const isDuplicate = error.message.includes('sudah terdaftar');
      if (isDuplicate) {
        setFormError(error.message);
      }
      showToast(error.message || 'Gagal menyimpan data ke server', 'error');
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormError(null);
    setFormData({
      ...initialForm,
      kesatuan: isSuperAdmin ? '' : currentUser.kesatuan
    });
    setIsModalOpen(true);
  };

  return (
    <motion.main 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 md:p-8 space-y-6 transition-colors duration-300"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-extrabold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
            {isAdminPolres ? 'Data User' : 'Manajemen Personel & Role'}
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1">
            {isSuperAdmin ? 'Kelola data seluruh personel dan penetapan admin kesatuan.' : 'Kelola data seluruh user dalam sistem.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Import Dropdown */}
          {!isAdminPolres && (
            <div className="relative" ref={dropdownRef}>
              <button 
                onClick={() => setShowImportDropdown(!showImportDropdown)}
                className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 border-2 ${
                  isDarkMode ? 'border-slate-800 text-slate-400 hover:bg-slate-800' : 'border-slate-100 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <span className="material-symbols-outlined text-lg">upload_file</span>
                Import
                <span className="material-symbols-outlined text-sm">expand_more</span>
              </button>
              
              {showImportDropdown && (
                <div className={`absolute right-0 mt-2 w-48 rounded-2xl shadow-2xl border z-[110] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 ${
                  isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
                }`}>
                  <button 
                    onClick={() => handleImport('excel')}
                    className={`w-full text-left px-5 py-3.5 text-xs font-bold flex items-center gap-3 transition-colors ${
                      isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-emerald-500">table_view</span>
                    Excel (.xlsx, .xls)
                  </button>
                  <button 
                    onClick={() => handleImport('csv')}
                    className={`w-full text-left px-5 py-3.5 text-xs font-bold flex items-center gap-3 transition-colors ${
                      isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="material-symbols-outlined text-blue-500">description</span>
                    CSV (.csv)
                  </button>
                </div>
              )}
            </div>
          )}

          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={handleFileChange}
          />

          {!isAdminPolres && (
            <button 
              onClick={openAddModal}
              className="bg-sky-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-sky-200 hover:bg-sky-700 transition-all flex items-center gap-2 active:scale-95"
            >
              <span className="material-symbols-outlined text-lg">person_add</span>
              Tambah Personel
            </button>
          )}
        </div>
      </div>

      {/* Stats Overview */}
      <div className={`grid gap-3 md:gap-4 ${isAdminPolres ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
        <div className={`p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total {isAdminPolres ? 'User' : 'Personel'}</div>
          <div className={`text-xl md:text-2xl font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{stats.total}</div>
        </div>
        {!isAdminPolres && (
          <>
            <div className={`p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
              <div className="text-[8px] md:text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">Super Admin</div>
              <div className={`text-xl md:text-2xl font-black ${isDarkMode ? 'text-rose-500' : 'text-rose-600'}`}>{stats.superAdmin}</div>
            </div>
            <div className={`p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
              <div className="text-[8px] md:text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Admin Polres</div>
              <div className={`text-xl md:text-2xl font-black ${isDarkMode ? 'text-indigo-500' : 'text-indigo-600'}`}>{stats.admin}</div>
            </div>
          </>
        )}
        <div className={`p-4 md:p-5 rounded-2xl md:rounded-3xl border transition-all ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-sm'}`}>
          <div className="text-[8px] md:text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">User Aktif</div>
          <div className={`text-xl md:text-2xl font-black ${isDarkMode ? 'text-emerald-500' : 'text-emerald-600'}`}>{stats.active}</div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className={`transition-all duration-300 ${selectedPersonnel ? 'lg:w-2/3 w-full' : 'w-full'}`}>
          <div className={`rounded-2xl shadow-sm border overflow-hidden flex flex-col transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
            <div className={`p-6 border-b flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors duration-300 ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
              <div className="flex items-center gap-2 w-full max-w-2xl">
                <div className="relative flex-1">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">search</span>
                  <input 
                    type="text" 
                    placeholder="Cari nama, NRP, atau kesatuan..." 
                    className={`w-full h-[48px] md:h-[42px] pl-12 pr-6 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-sky-500/10 font-bold text-sm transition-all ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-800'
                    }`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualSearch()}
                  />
                </div>
                <button 
                  onClick={() => setIsFilterModalOpen(true)}
                  className={`md:hidden flex items-center justify-center w-[48px] h-[48px] border rounded-xl transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-600'}`}
                >
                  <span className="material-symbols-outlined">filter_list</span>
                </button>
                <button 
                  onClick={handleManualSearch}
                  className="hidden md:block bg-sky-600 text-white px-6 py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-sky-700 transition-all active:scale-95 shadow-lg shadow-sky-200/20"
                >
                  Cari
                </button>
              </div>

              <div className="hidden md:flex flex-wrap items-center gap-4">
                {!isAdminPolres && (
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Role:</span>
                    <select 
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      className={`px-4 py-2.5 rounded-xl border text-xs font-bold focus:outline-none transition-all ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      <option value="ALL">Semua Role</option>
                      <option value={UserRole.SUPERADMIN}>Super Admin</option>
                      <option value={UserRole.ADMIN}>Admin</option>
                      <option value={UserRole.USER}>User</option>
                    </select>
                  </div>
                )}

                {isSuperAdmin && (
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unit:</span>
                    <div className="relative" ref={filterUnitRef}>
                      <div 
                        onClick={() => setIsFilterUnitOpen(!isFilterUnitOpen)}
                        className={`px-4 py-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all min-w-[180px] ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <span className="text-xs font-bold">
                          {filterKesatuan === 'ALL' ? 'Semua Unit' : filterKesatuan}
                        </span>
                        <span className="material-symbols-outlined text-slate-400 text-sm">expand_more</span>
                      </div>
                      
                      {isFilterUnitOpen && (
                        <div className={`absolute left-0 right-0 mt-2 rounded-2xl shadow-2xl border z-[120] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 min-w-[220px] ${
                          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
                        }`}>
                          <div className="p-3 border-b border-slate-100 dark:border-slate-800">
                            <div className="relative">
                              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">search</span>
                              <input 
                                type="text"
                                placeholder="Cari kesatuan..."
                                className={`w-full pl-9 pr-4 py-2 rounded-xl border text-xs font-bold focus:outline-none ${
                                  isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-800'
                                }`}
                                value={filterUnitSearch}
                                onChange={(e) => setFilterUnitSearch(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                              />
                            </div>
                          </div>
                          <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                            <button
                              type="button"
                              onClick={() => {
                                setFilterKesatuan('ALL');
                                setIsFilterUnitOpen(false);
                                setFilterUnitSearch('');
                              }}
                              className={`w-full text-left px-5 py-3 text-xs font-bold transition-colors ${
                                filterKesatuan === 'ALL' 
                                  ? (isDarkMode ? 'bg-sky-500/10 text-sky-400' : 'bg-sky-50 text-sky-600')
                                  : (isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50')
                              }`}
                            >
                              Semua Unit
                            </button>
                            {filteredFilterUnits.length > 0 ? (
                              filteredFilterUnits.map((u) => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onClick={() => {
                                    setFilterKesatuan(u.nama);
                                    setIsFilterUnitOpen(false);
                                    setFilterUnitSearch('');
                                  }}
                                  className={`w-full text-left px-5 py-3 text-xs font-bold flex items-center justify-between transition-colors ${
                                    filterKesatuan === u.nama 
                                      ? (isDarkMode ? 'bg-sky-500/10 text-sky-400' : 'bg-sky-50 text-sky-600')
                                      : (isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50')
                                  }`}
                                >
                                  <span>{u.nama}</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                                    u.tipe === 'POLDA' ? 'bg-rose-500/10 text-rose-500' : 
                                    u.tipe === 'POLRES' ? 'bg-blue-500/10 text-blue-500' : 'bg-slate-500/10 text-slate-500'
                                  }`}>
                                    {u.tipe}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <div className="px-5 py-4 text-xs text-slate-500 italic text-center">Tidak ada hasil</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-nowrap">
                <thead>
                  <tr className={`font-bold text-[11px] uppercase tracking-widest border-b transition-colors duration-300 ${isDarkMode ? 'bg-slate-800/50 text-slate-500 border-slate-800' : 'bg-slate-50/50 text-slate-400 border-slate-100'}`}>
                    <th className="px-6 py-4 cursor-pointer hover:text-sky-500 transition-colors" onClick={() => requestSort('nama')}>
                      <div className="flex items-center gap-1">
                        Nama Personel {getSortIcon('nama')}
                      </div>
                    </th>
                    <th className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        <div className="cursor-pointer hover:text-sky-500 transition-colors flex items-center gap-1" onClick={() => requestSort('pangkat')}>
                          Pangkat {getSortIcon('pangkat')}
                        </div>
                        <span className="text-slate-300">/</span>
                        <div className="cursor-pointer hover:text-sky-500 transition-colors flex items-center gap-1" onClick={() => requestSort('nrp')}>
                          NRP {getSortIcon('nrp')}
                        </div>
                      </div>
                    </th>
                    <th className="px-6 py-4">
                      <div className="flex items-center gap-4">
                        {!isAdminPolres && (
                          <>
                            <div className="cursor-pointer hover:text-sky-500 transition-colors flex items-center gap-1" onClick={() => requestSort('role')}>
                              Role {getSortIcon('role')}
                            </div>
                            <span className="text-slate-300">/</span>
                          </>
                        )}
                        <div className="cursor-pointer hover:text-sky-500 transition-colors flex items-center gap-1" onClick={() => requestSort('kesatuan')}>
                          Kesatuan {getSortIcon('kesatuan')}
                        </div>
                      </div>
                    </th>
                    {isSuperAdmin && (
                      <th className="px-6 py-4 cursor-pointer hover:text-sky-500 transition-colors" onClick={() => requestSort('email')}>
                        <div className="flex items-center gap-1">
                          Email {getSortIcon('email')}
                        </div>
                      </th>
                    )}
                    {isSuperAdmin && (
                      <th className="px-6 py-4">
                        <div className="flex items-center gap-1">
                          Password
                        </div>
                      </th>
                    )}
                    <th className="px-6 py-4 cursor-pointer hover:text-sky-500 transition-colors" onClick={() => requestSort('status')}>
                      <div className="flex items-center gap-1">
                        Status {getSortIcon('status')}
                      </div>
                    </th>
                    {!isAdminPolres && <th className="px-6 py-4 text-right">Aksi</th>}
                  </tr>
                </thead>
                <tbody className={`divide-y transition-colors duration-300 ${isDarkMode ? 'divide-slate-800' : 'divide-slate-50'}`}>
                  {personnel.map((p) => (
                    <tr 
                      key={p.id} 
                      onClick={() => setSelectedPersonnel(p)}
                      className={`transition-colors group cursor-pointer ${
                        selectedPersonnel?.id === p.id 
                          ? (isDarkMode ? 'bg-sky-500/10' : 'bg-sky-50') 
                          : (isDarkMode ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50/40')
                      }`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${isDarkMode ? 'bg-sky-500/10 text-sky-400' : 'bg-sky-50 text-sky-600'}`}>
                            {p.nama.charAt(0)}
                          </div>
                          <div className={`font-bold text-sm ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{p.nama}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className={`text-sm font-bold ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{p.pangkat}</div>
                        <div className="text-xs text-slate-400 font-medium">{p.nrp}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          {!isAdminPolres && (
                            <span className={`w-fit px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                              p.role === UserRole.SUPERADMIN ? (isDarkMode ? 'bg-rose-500/10 text-rose-400' : 'bg-rose-50 text-rose-600') : 
                              p.role === UserRole.ADMIN ? (isDarkMode ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-50 text-indigo-600') : (isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600')
                            }`}>
                              {p.role}
                            </span>
                          )}
                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{p.kesatuan}</div>
                        </div>
                      </td>
                      {isSuperAdmin && (
                        <td className="px-6 py-4">
                          <div className={`text-xs font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                            {p.email}
                          </div>
                        </td>
                      )}
                      {isSuperAdmin && (
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <code className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${isDarkMode ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
                              {p.passwordPlain}
                            </code>
                          </div>
                        </td>
                      )}
                      <td className="px-6 py-4">
                        <span className={`flex items-center gap-1.5 text-xs font-bold ${
                          p.status === 'Aktif' ? 'text-emerald-600' : 'text-slate-400'
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${p.status === 'Aktif' ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                          {p.status}
                        </span>
                      </td>
                      {!isAdminPolres && (
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleEdit(p); }}
                              className={`p-2 rounded-lg transition-all ${isDarkMode ? 'text-slate-500 hover:text-sky-400 hover:bg-sky-500/10' : 'text-slate-400 hover:text-sky-600 hover:bg-sky-50'}`}
                            >
                              <span className="material-symbols-outlined text-lg">edit</span>
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                              className={`p-2 rounded-lg transition-all ${isDarkMode ? 'text-slate-500 hover:text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
                            >
                              <span className="material-symbols-outlined text-lg">block</span>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {personnel.length === 0 && (
                    <tr>
                      <td colSpan={isSuperAdmin ? 7 : 5} className="px-6 py-12 text-center text-slate-400 italic">Data tidak ditemukan.</td>
                    </tr>
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
                  </div>
                ))
              ) : (
                personnel.map((p) => (
                  <div 
                    key={p.id} 
                    onClick={() => setSelectedPersonnel(p)}
                    className={`p-4 space-y-4 transition-colors duration-300 ${selectedPersonnel?.id === p.id ? (isDarkMode ? 'bg-sky-500/10' : 'bg-sky-50') : (isDarkMode ? 'bg-slate-900' : 'bg-white')}`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm ${isDarkMode ? 'bg-slate-800 text-sky-400' : 'bg-slate-100 text-sky-600'}`}>
                          {p.nama.charAt(0)}
                        </div>
                        <div>
                          <h3 className={`text-sm font-black uppercase tracking-tight truncate max-w-[180px] ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                            {p.nama}
                          </h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-black font-mono text-slate-500">{p.nrp}</span>
                            <span className={`w-1 h-1 rounded-full ${isDarkMode ? 'bg-slate-700' : 'bg-slate-200'}`}></span>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{p.pangkat}</span>
                          </div>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${
                        p.status === 'Aktif' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-slate-500'
                      }`}>
                        {p.status}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">account_balance</span>
                        {p.kesatuan}
                      </div>
                      {!isAdminPolres && (
                        <div className="flex gap-2">
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleEdit(p); }}
                            className={`p-2 rounded-xl border ${isDarkMode ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-500'}`}
                          >
                            <span className="material-symbols-outlined text-lg">edit</span>
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                            className={`p-2 rounded-xl border ${isDarkMode ? 'border-slate-800 text-rose-500' : 'border-slate-100 text-rose-600'}`}
                          >
                            <span className="material-symbols-outlined text-lg">block</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {personnel.length === 0 && !isLoading && (
                <div className="p-12 text-center">
                  <span className="material-symbols-outlined text-4xl opacity-20">database_off</span>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-2">Tidak ada data</p>
                </div>
              )}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className={`p-4 border-t flex flex-col sm:flex-row items-center justify-between gap-4 transition-colors duration-300 ${isDarkMode ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50/30'}`}>
                <div className="flex items-center gap-4">
                  <div className="text-xs font-bold text-slate-500">
                    Menampilkan <span className="text-sky-600">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="text-sky-600">{Math.min(currentPage * itemsPerPage, totalItems)}</span> dari <span className="text-sky-600">{totalItems}</span> data
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase">Baris:</span>
                    <select 
                      value={itemsPerPage}
                      onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                      className={`px-2 py-1 rounded-lg border text-[10px] font-bold focus:outline-none ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200'}`}
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className={`p-2 rounded-xl transition-all ${
                      currentPage === 1 
                        ? 'text-slate-300 cursor-not-allowed' 
                        : (isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-600 hover:bg-white hover:shadow-sm')
                    }`}
                  >
                    <span className="material-symbols-outlined">chevron_left</span>
                  </button>
                  
                  <div className="flex items-center gap-1">
                    {[...Array(totalPages)].map((_, i) => {
                      const pageNum = i + 1;
                      // Show first, last, and pages around current
                      if (
                        pageNum === 1 || 
                        pageNum === totalPages || 
                        (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                      ) {
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`w-8 h-8 rounded-lg text-xs font-black transition-all ${
                              currentPage === pageNum
                                ? 'bg-sky-600 text-white shadow-lg shadow-sky-200'
                                : (isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-600 hover:bg-white hover:shadow-sm')
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      } else if (
                        (pageNum === 2 && currentPage > 3) || 
                        (pageNum === totalPages - 1 && currentPage < totalPages - 2)
                      ) {
                        return <span key={pageNum} className="text-slate-400 text-xs">...</span>;
                      }
                      return null;
                    })}
                  </div>

                  <button 
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className={`p-2 rounded-xl transition-all ${
                      currentPage === totalPages 
                        ? 'text-slate-300 cursor-not-allowed' 
                        : (isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-600 hover:bg-white hover:shadow-sm')
                    }`}
                  >
                    <span className="material-symbols-outlined">chevron_right</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Detail Panel / Modal */}
        <AnimatePresence>
          {selectedPersonnel && (
            <div className="fixed inset-0 z-[300] lg:relative lg:z-0 lg:block lg:w-1/3 w-full flex items-end lg:items-start lg:sticky lg:top-8 animate-in fade-in duration-300">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm lg:hidden" onClick={() => setSelectedPersonnel(null)} />
              <motion.div 
                initial={{ opacity: 0, x: 20, y: 100 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, x: 20, y: 100 }}
                className={`relative w-full rounded-t-[2.5rem] lg:rounded-[2.5rem] shadow-2xl border overflow-hidden flex flex-col transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}
              >
                <div className="p-8 space-y-8">
                  <div className="flex items-center justify-between">
                    <div className={`text-[10px] font-black uppercase tracking-[0.2em] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>Detail Personel</div>
                    <button 
                      onClick={() => setSelectedPersonnel(null)}
                      className={`p-2 rounded-full transition-all ${isDarkMode ? 'text-slate-500 hover:bg-slate-800 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800'}`}
                    >
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>

                  <div className="flex flex-col items-center text-center space-y-4">
                    <div className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center text-2xl md:text-3xl font-black shadow-2xl ${isDarkMode ? 'bg-sky-500/20 text-sky-400' : 'bg-sky-50 text-sky-600'}`}>
                      {selectedPersonnel.nama.charAt(0)}
                    </div>
                    <div>
                      <h2 className={`text-lg md:text-xl font-black uppercase tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{selectedPersonnel.nama}</h2>
                      <p className="text-xs md:text-sm text-slate-500 font-bold uppercase tracking-widest">{selectedPersonnel.pangkat} — {selectedPersonnel.nrp}</p>
                    </div>
                    <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                      selectedPersonnel.status === 'Aktif' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-500/10 text-slate-500'
                    }`}>
                      {selectedPersonnel.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className={`p-4 md:p-5 rounded-3xl border transition-colors ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                      <div className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Jabatan & Kesatuan</div>
                      <div className={`text-xs md:text-sm font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{selectedPersonnel.jabatan}</div>
                      <div className="text-[10px] text-sky-600 font-black uppercase tracking-tight mt-1">{selectedPersonnel.kesatuan}</div>
                    </div>

                    <div className={`p-4 md:p-5 rounded-3xl border transition-colors ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                      <div className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Email / Kontak</div>
                      <div className={`text-xs md:text-sm font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{selectedPersonnel.email || '-'}</div>
                    </div>

                    {!isAdminPolres && (
                      <div className={`p-4 md:p-5 rounded-3xl border transition-colors ${isDarkMode ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
                        <div className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Hak Akses (Role)</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase ${
                            selectedPersonnel.role === UserRole.SUPERADMIN ? 'bg-rose-500 text-white' : 
                            selectedPersonnel.role === UserRole.ADMIN ? 'bg-indigo-500 text-white' : 'bg-slate-500 text-white'
                          }`}>
                            {selectedPersonnel.role}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 flex gap-3">
                    <button 
                      onClick={() => handleEdit(selectedPersonnel)}
                      className="flex-1 h-[56px] bg-sky-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-sky-700 shadow-lg shadow-sky-200/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                      Edit Data
                    </button>
                    <button 
                      onClick={() => handleDelete(selectedPersonnel.id)}
                      className={`w-[56px] h-[56px] rounded-2xl font-black transition-all active:scale-95 border-2 flex items-center justify-center ${
                        isDarkMode ? 'border-slate-800 text-rose-500 hover:bg-rose-500/10' : 'border-slate-100 text-rose-600 hover:bg-rose-50'
                      }`}
                    >
                      <span className="material-symbols-outlined">block</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating Action Button for Mobile */}
      <button 
        onClick={openAddModal}
        className="md:hidden fixed right-6 bottom-6 w-14 h-14 bg-sky-600 text-white rounded-full shadow-2xl flex items-center justify-center z-[100] active:scale-90 transition-transform"
      >
        <span className="material-symbols-outlined text-3xl">add</span>
      </button>

      {/* MOBILE FILTER MODAL */}
      <AnimatePresence>
        {isFilterModalOpen && (
          <div className="fixed inset-0 z-[400] md:hidden flex items-end print:hidden">
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
              
              <h3 className={`text-lg font-black uppercase tracking-tight mb-6 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Filter Personel</h3>
              
              <div className="space-y-6">
                {!isAdminPolres && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Role</label>
                    <select 
                      className={`w-full h-[52px] px-4 border rounded-2xl text-xs font-bold outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                    >
                      <option value="ALL">Semua Role</option>
                      <option value={UserRole.SUPERADMIN}>Super Admin</option>
                      <option value={UserRole.ADMIN}>Admin</option>
                      <option value={UserRole.USER}>User</option>
                    </select>
                  </div>
                )}

                {isSuperAdmin && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unit / Kesatuan</label>
                    <select 
                      className={`w-full h-[52px] px-4 border rounded-2xl text-xs font-bold outline-none transition-all ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'}`}
                      value={filterKesatuan}
                      onChange={(e) => setFilterKesatuan(e.target.value)}
                    >
                      <option value="ALL">Semua Unit</option>
                      {kesatuanList.map(k => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setIsFilterModalOpen(false)}
                    className="flex-1 h-[56px] bg-sky-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-sky-900/20"
                  >
                    TERAPKAN
                  </button>
                  <button 
                    onClick={() => { handleResetFilters(); setIsFilterModalOpen(false); }}
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

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[500] flex items-end md:items-center justify-center md:p-4 bg-black/70 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 100 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 100 }}
              className={`rounded-t-[2.5rem] md:rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}
            >
              <div className={`p-8 border-b flex items-center justify-between transition-colors duration-300 ${isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-50/50 border-slate-100'}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isDarkMode ? 'bg-sky-500/10 text-sky-400' : 'bg-sky-50 text-sky-600'}`}>
                    <span className="material-symbols-outlined text-3xl">{editingId ? 'edit_square' : 'person_add'}</span>
                  </div>
                  <div>
                    <h3 className={`text-xl font-black ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                      {editingId ? 'Edit Data Personel' : 'Tambah Personel Baru'}
                    </h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Lengkapi informasi data anggota</p>
                  </div>
                </div>
                <button onClick={() => setIsModalOpen(false)} className={`p-3 rounded-full transition-all ${isDarkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-800'}`}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              
              <form onSubmit={handleSave} className="p-8 space-y-6 overflow-y-auto max-h-[calc(100vh-200px)] scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                {formError && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-100 flex items-start gap-3"
                  >
                    <span className="material-symbols-outlined text-rose-500 mt-0.5">warning</span>
                    <p className="text-sm font-bold text-rose-800 leading-relaxed">{formError}</p>
                  </motion.div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider pl-1">Nama Lengkap</label>
                    <input 
                      type="text" 
                      placeholder="Masukkan Nama Lengkap"
                      className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-bold text-sm transition-colors duration-300 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                      }`}
                      value={formData.nama}
                      onChange={(e) => setFormData({...formData, nama: e.target.value})}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider pl-1">Pangkat</label>
                    <input 
                      type="text" 
                      placeholder="Contoh: Brigadir"
                      className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-bold text-sm transition-colors duration-300 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                      }`}
                      value={formData.pangkat}
                      onChange={(e) => setFormData({...formData, pangkat: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider pl-1">NRP / NIP</label>
                    <input 
                      type="text" 
                      placeholder="99999999"
                      className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-bold text-sm transition-colors duration-300 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                      }`}
                      value={formData.nrp}
                      onChange={(e) => setFormData({...formData, nrp: e.target.value})}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider pl-1">Jabatan</label>
                    <input 
                      type="text" 
                      placeholder="User Testing"
                      className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-bold text-sm transition-colors duration-300 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                      }`}
                      value={formData.jabatan}
                      onChange={(e) => setFormData({...formData, jabatan: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider pl-1">Kesatuan</label>
                    {isSuperAdmin ? (
                      <div className="relative" ref={modalUnitRef}>
                        <div 
                          onClick={() => setIsModalUnitOpen(!isModalUnitOpen)}
                          className={`w-full px-4 py-3 rounded-xl border flex items-center justify-between cursor-pointer transition-colors duration-300 ${
                            isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                          }`}
                        >
                          <span className={formData.kesatuan ? 'font-bold text-sm' : 'text-slate-400 text-sm'}>
                            {formData.kesatuan || 'Pilih Kesatuan'}
                          </span>
                          <span className="material-symbols-outlined text-slate-400">expand_more</span>
                        </div>
                        
                        {isModalUnitOpen && (
                          <div className={`absolute left-0 right-0 mt-2 rounded-2xl shadow-2xl border z-[120] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 ${
                            isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
                          }`}>
                            <div className="p-3 border-b border-slate-100 dark:border-slate-800">
                              <div className="relative">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">search</span>
                                <input 
                                  type="text"
                                  placeholder="Cari kesatuan..."
                                  className={`w-full pl-9 pr-4 py-2 rounded-xl border text-xs font-bold focus:outline-none ${
                                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-800'
                                  }`}
                                  value={modalUnitSearch}
                                  onChange={(e) => setModalUnitSearch(e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  autoFocus
                                />
                              </div>
                            </div>
                            <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                              {filteredModalUnits.length > 0 ? (
                                filteredModalUnits.map((u) => (
                                  <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => {
                                      setFormData({...formData, kesatuan: u.nama});
                                      setIsModalUnitOpen(false);
                                      setModalUnitSearch('');
                                    }}
                                    className={`w-full text-left px-5 py-3 text-xs font-bold flex items-center justify-between transition-colors ${
                                      formData.kesatuan === u.nama 
                                        ? (isDarkMode ? 'bg-sky-500/10 text-sky-400' : 'bg-sky-50 text-sky-600')
                                        : (isDarkMode ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-700 hover:bg-slate-50')
                                    }`}
                                  >
                                    <span>{u.nama}</span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${
                                      u.tipe === 'POLDA' ? 'bg-rose-500/10 text-rose-500' : 
                                      u.tipe === 'POLRES' ? 'bg-blue-500/10 text-blue-500' : 'bg-slate-500/10 text-slate-500'
                                    }`}>
                                      {u.tipe}
                                    </span>
                                  </button>
                                ))
                              ) : (
                                <div className="px-5 py-4 text-xs text-slate-500 italic text-center">Tidak ada hasil</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <input 
                        type="text" 
                        placeholder="Polres Malang"
                        className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-bold text-sm transition-colors duration-300 ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                        } ${!isSuperAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                        value={formData.kesatuan}
                        onChange={(e) => setFormData({...formData, kesatuan: e.target.value})}
                        readOnly={!isSuperAdmin}
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider pl-1">Email</label>
                    <input 
                      type="email" 
                      placeholder="testing@polri.go.id"
                      className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-bold text-sm transition-colors duration-300 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                      }`}
                      value={formData.email}
                      onChange={(e) => setFormData({...formData, email: e.target.value})}
                    />
                  </div>
                  {isSuperAdmin && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-black text-slate-500 uppercase tracking-wider pl-1">Role</label>
                      <select 
                        className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-bold text-sm transition-colors duration-300 ${
                          isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                        }`}
                        value={formData.role}
                        onChange={(e) => setFormData({...formData, role: e.target.value as UserRole})}
                      >
                        <option value={UserRole.USER}>User</option>
                        <option value={UserRole.ADMIN}>Admin</option>
                        <option value={UserRole.SUPERADMIN}>Super Admin</option>
                      </select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider pl-1">Status</label>
                    <select 
                      className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500/20 font-bold text-sm transition-colors duration-300 ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
                      }`}
                      value={formData.status}
                      onChange={(e) => setFormData({...formData, status: e.target.value})}
                    >
                      <option value="Aktif">Aktif</option>
                      <option value="Nonaktif">Nonaktif</option>
                    </select>
                  </div>
                </div>

                <div className="pt-6 flex items-center justify-end gap-4 border-t border-slate-100 dark:border-slate-800">
                  <button 
                    type="button" 
                    onClick={() => setIsModalOpen(false)}
                    className={`px-8 py-4 rounded-2xl font-black transition-all text-xs uppercase tracking-widest ${isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    Batal
                  </button>
                  <button 
                    type="submit"
                    disabled={!formData.nama || !formData.nrp}
                    className={`px-10 py-4 bg-sky-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-sky-700 shadow-2xl shadow-sky-200/20 transition-all active:scale-95 ${(!formData.nama || !formData.nrp) ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {editingId ? 'Simpan Perubahan' : 'Tambah Personel'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Action Modal (Delete/Deactivate) */}
      <AnimatePresence>
        {actionTarget && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}
            >
              <div className="p-10 text-center space-y-8 overflow-y-auto max-h-[90vh] scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700">
                <div className={`w-24 h-24 mx-auto rounded-[2rem] flex items-center justify-center shadow-2xl transition-all duration-500 ${
                  actionStep === 'choice' 
                    ? (isDarkMode ? 'bg-amber-500/10 text-amber-500 shadow-amber-500/10' : 'bg-amber-50 text-amber-600 shadow-amber-100')
                    : (actionType === 'delete' ? (isDarkMode ? 'bg-rose-500/10 text-rose-500 shadow-rose-500/10' : 'bg-rose-50 text-rose-600 shadow-rose-100') : (isDarkMode ? 'bg-blue-500/10 text-blue-500 shadow-blue-500/10' : 'bg-blue-50 text-blue-600 shadow-blue-100'))
                }`}>
                  <span className="material-symbols-outlined text-5xl animate-pulse">
                    {actionStep === 'choice' ? 'warning' : (actionType === 'delete' ? 'delete_forever' : 'block')}
                  </span>
                </div>

                {actionStep === 'choice' ? (
                  <div className="space-y-6">
                    <div className="space-y-2">
                      <h3 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Tindakan Personel</h3>
                      <p className="text-sm text-slate-500 font-medium leading-relaxed">
                        Pilih tindakan yang ingin dilakukan untuk <br/> <span className="font-black text-sky-600 text-base">{actionTarget.nama}</span>
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                      <button 
                        onClick={() => { setActionType('deactivate'); setActionStep('confirm'); }}
                        className={`flex items-center justify-between px-8 py-5 rounded-3xl border-2 transition-all group active:scale-95 ${
                          isDarkMode ? 'border-slate-800 hover:border-blue-500 bg-slate-800/50' : 'border-slate-100 hover:border-blue-500 bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-5">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-blue-500/20' : 'bg-blue-100'}`}>
                            <span className="material-symbols-outlined text-blue-500 text-2xl">block</span>
                          </div>
                          <div className="text-left">
                            <div className={`text-sm font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Nonaktifkan</div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Ubah status ke Nonaktif</div>
                          </div>
                        </div>
                        <span className="material-symbols-outlined text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all">chevron_right</span>
                      </button>
                      <button 
                        onClick={() => { setActionType('delete'); setActionStep('confirm'); }}
                        className={`flex items-center justify-between px-8 py-5 rounded-3xl border-2 transition-all group active:scale-95 ${
                          isDarkMode ? 'border-slate-800 hover:border-rose-500 bg-slate-800/50' : 'border-slate-100 hover:border-rose-500 bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center gap-5">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-rose-500/20' : 'bg-rose-100'}`}>
                            <span className="material-symbols-outlined text-rose-500 text-2xl">delete_forever</span>
                          </div>
                          <div className="text-left">
                            <div className={`text-sm font-black ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Hapus Permanen</div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Hapus data dari sistem</div>
                          </div>
                        </div>
                        <span className="material-symbols-outlined text-slate-300 group-hover:text-rose-500 group-hover:translate-x-1 transition-all">chevron_right</span>
                      </button>
                    </div>
                    <button 
                      onClick={() => setActionTarget(null)}
                      className={`w-full py-4 text-xs font-black uppercase tracking-widest transition-all ${isDarkMode ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-800'}`}
                    >
                      Batalkan
                    </button>
                  </div>
                ) : (
                  <div className="space-y-8">
                    <div className="space-y-3">
                      <h3 className={`text-2xl font-black tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Konfirmasi Akhir</h3>
                      <p className="text-sm text-slate-500 font-medium leading-relaxed">
                        Apakah Anda benar-benar yakin ingin {actionType === 'delete' ? <span className="text-rose-600 font-black">MENGHAPUS</span> : <span className="text-blue-600 font-black">MENONAKTIFKAN</span>} data <span className="font-bold text-sky-600">{actionTarget.nama}</span>?
                      </p>
                    </div>
                    
                    <div className="flex flex-col gap-3">
                      <button 
                        onClick={executeAction}
                        className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-2xl transition-all active:scale-95 ${
                          actionType === 'delete' 
                            ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-200/20' 
                            : 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200/20'
                        }`}
                      >
                        Ya, Saya Yakin
                      </button>
                      <button 
                        onClick={() => setActionStep('choice')}
                        className={`w-full py-4 text-xs font-black uppercase tracking-widest transition-all ${isDarkMode ? 'text-slate-500 hover:text-white' : 'text-slate-400 hover:text-slate-800'}`}
                      >
                        Kembali
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes scaleIn {
          from { transform: scale(0.9); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-scale-in { animation: scaleIn 0.2s ease-out forwards; }
      `}</style>
    </motion.main>
  );
};

export default PersonnelData;
