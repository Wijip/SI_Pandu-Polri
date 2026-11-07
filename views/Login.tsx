
import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Personnel, LogEntry, SiteSettings } from '../types';

interface LoginProps {
  onLogin: (user: Personnel) => void;
  addLog?: (aktivitas: LogEntry['aktivitas'], keterangan: string) => void;
  siteSettings: SiteSettings;
  currentUser?: Personnel | null;
}

const Login: React.FC<LoginProps> = ({ onLogin, addLog, siteSettings, currentUser }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [redirectToDashboard, setRedirectToDashboard] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // MFA States (Fase 9.4: tempToken signed JWT)
  const [showMfaForm, setShowMfaForm] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [userIdentifier, setUserIdentifier] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [mfaMessage, setMfaMessage] = useState('');

  // Redirect if already logged in
  if (currentUser || redirectToDashboard) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password })
      });
      
      const data = await res.json();
      
      if (data.success && data.mfa_required) {
        // Show MFA Form with tempToken (Sequence Diagram Fig 3.10)
        setUserIdentifier(data.identifier);
        setTempToken(data.tempToken || '');
        setMfaMessage(data.message);
        setShowMfaForm(true);
      } else if (data.success) {
        // Fallback if MFA is somehow bypassed by backend
        onLogin(data.user);
        setRedirectToDashboard(true);
      } else {
        setError(data.message || 'Akses ditolak. Email atau kata sandi tidak valid.');
      }
    } catch (err) {
      setError('Terjadi kesalahan koneksi ke server.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login/verify-mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identifier: userIdentifier, code: mfaCode, tempToken })
      });
      
      const data = await res.json();
      
      if (data.success) {
        onLogin(data.user);
        setRedirectToDashboard(true);
      } else {
        setError(data.message || 'Kode OTP tidak valid atau sudah kadaluarsa.');
      }
    } catch (err) {
      setError('Terjadi kesalahan koneksi ke server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-white flex flex-col md:flex-row font-sans overflow-hidden">
      <style>{`
        @media (max-width: 768px) {
          .login-mobile-bg {
            background-color: #0f172a;
            background-image: linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.6)), url('/img/polda_building.webp');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
          }
          .glass-mobile {
            background: rgba(255, 255, 255, 0.1) !important;
            backdrop-filter: blur(12px) !important;
            -webkit-backdrop-filter: blur(12px) !important;
            border: 1px solid rgba(255, 255, 255, 0.2) !important;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important;
          }
        }
      `}</style>
      
      {/* Bagian Kiri dengan Gambar Latar Belakang */}
      <div className="hidden md:flex md:w-[50%] lg:w-[55%] relative flex-col justify-between p-12 text-white overflow-hidden">
        <div 
          className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-700 scale-105 hover:scale-100"
          style={{ backgroundImage: 'url("/img/polda_building.webp")' }}
        >
          {/* Overlay Biru Transparan */}
          <div className="absolute inset-0 bg-blue-900/60 mix-blend-multiply"></div>
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-950/90 via-blue-900/40 to-transparent"></div>
        </div>

        <div className="relative z-10 flex flex-col items-start gap-8 mt-20">
          {/* Logo Tanpa Frame - Lebih Clean */}
          <div className="w-32 h-32 flex items-center justify-center">
            <img 
              src={siteSettings.logo || "/img/Pandu.png"} 
              alt="Logo Unit" 
              className="w-full h-full object-contain drop-shadow-[0_20px_50px_rgba(0,0,0,0.5)]" 
            />
          </div>
          
          <div className="space-y-4">
            <h1 className="text-4xl font-black tracking-tight leading-tight uppercase drop-shadow-lg max-w-lg">
              {siteSettings.loginTitle || 'Reset Password Email Polri'}
            </h1>
            <h2 className="text-2xl font-bold tracking-tight uppercase opacity-90 drop-shadow-md">
              {siteSettings.loginSubtitle || 'Bid Tik Polda Jatim'}
            </h2>
          </div>
          
          <div className="pl-6 border-l-4 border-sky-400/60 space-y-2 py-1">
            <p className="text-xl font-bold tracking-wider drop-shadow-md uppercase">{siteSettings.loginTagline1 || 'MENGABDI DENGAN INTEGRITAS'}</p>
            <p className="text-xl font-bold tracking-wider drop-shadow-md uppercase">{siteSettings.loginTagline2 || 'MELAYANI DENGAN TEKNOLOGI'}</p>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between w-full opacity-70 text-[10px] font-black uppercase tracking-[0.3em]">
          <span>© 2026 {siteSettings.name} - Bid Tik</span>
          <span>V 1.0</span>
        </div>
      </div>

      {/* Bagian Kanan - Formulir Login */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-16 lg:p-24 bg-white md:bg-white shadow-[-20px_0_50px_rgba(0,0,0,0.05)] login-mobile-bg relative overflow-y-auto">
        <div className="w-full max-w-md space-y-8 md:space-y-12 glass-mobile p-8 md:p-0 rounded-[2.5rem] md:rounded-none transition-all duration-500">
          
          {/* Mobile Logo Implementation */}
          <div className="md:hidden flex flex-col items-center justify-center mb-2">
            <img 
              src="/img/Pandu.png" 
              alt="Logo Pandu" 
              className="w-[120px] h-auto object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.4)] mb-2" 
            />
          </div>

          <div className="text-center md:text-left">
            <h2 className="text-3xl md:text-4xl font-black text-white md:text-slate-900 mb-3 md:mb-4 tracking-tight">
              {showMfaForm ? 'Verifikasi Keamanan' : 'Login Panel'}
            </h2>
            <p className="text-slate-200 md:text-slate-500 text-sm font-semibold leading-relaxed">
              {showMfaForm 
                ? mfaMessage || 'Silakan masukkan kode OTP yang telah dikirim ke email dinas Anda.' 
                : 'Selamat datang kembali. Silakan masukkan kredensial akun Anda untuk mengakses sistem administrasi.'}
            </p>
          </div>

          {!showMfaForm ? (
            <form onSubmit={handleSubmit} className="space-y-6 md:space-y-8">
              <div className="space-y-5 md:space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-300 md:text-slate-400 uppercase tracking-widest ml-1">Email Personel</label>
                  <div className="relative group">
                    <input 
                      type="email" 
                      className="w-full px-6 py-4 rounded-2xl border border-white/20 md:border-slate-100 bg-white/10 md:bg-slate-50/50 focus:bg-white/20 md:focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 font-bold text-white md:text-slate-700 placeholder:text-slate-400 md:placeholder:text-slate-300 transition-all pr-14"
                      placeholder="Masukkan Email Dinas"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                    <span className="material-symbols-outlined absolute right-5 top-1/2 -translate-y-1/2 text-slate-200 md:text-slate-300 group-focus-within:text-blue-500 transition-colors">mail</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <label className="text-xs font-black text-slate-300 md:text-slate-400 uppercase tracking-widest">Kata Sandi</label>
                  </div>
                  <div className="relative group">
                    <input 
                      type={showPassword ? "text" : "password"} 
                      className="w-full px-6 py-4 rounded-2xl border border-white/20 md:border-slate-100 bg-white/10 md:bg-slate-50/50 focus:bg-white/20 md:focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 font-bold text-white md:text-slate-700 placeholder:text-slate-400 md:placeholder:text-slate-300 transition-all pr-14"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <button 
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="material-symbols-outlined absolute right-5 top-1/2 -translate-y-1/2 text-slate-200 md:text-slate-300 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="text-[11px] font-bold text-rose-400 md:text-rose-600 bg-rose-500/10 md:bg-rose-50 p-4 rounded-2xl border border-rose-500/20 md:border-rose-100 flex items-center gap-3 animate-pulse">
                  <span className="material-symbols-outlined text-lg">warning</span>
                  {error}
                </div>
              )}

              <button 
                type="submit"
                disabled={isLoading}
                className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-widest text-white shadow-2xl flex items-center justify-center gap-4 transition-all active:scale-[0.97] ${
                  isLoading ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-900/20 hover:shadow-blue-900/40 hover:-translate-y-0.5'
                }`}
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    Proses Login
                    <span className="material-symbols-outlined text-xl">arrow_forward</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyMfa} className="space-y-6 md:space-y-8">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-300 md:text-slate-400 uppercase tracking-widest ml-1">Kode OTP (6 Digit)</label>
                <div className="relative group">
                  <input 
                    type="text" 
                    maxLength={6}
                    className="w-full px-6 py-4 text-center tracking-[0.5em] text-2xl rounded-2xl border border-white/20 md:border-slate-100 bg-white/10 md:bg-slate-50/50 focus:bg-white/20 md:focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 font-black text-white md:text-slate-700 placeholder:text-slate-400/50 md:placeholder:text-slate-300/50 transition-all"
                    placeholder="------"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="text-[11px] font-bold text-rose-400 md:text-rose-600 bg-rose-500/10 md:bg-rose-50 p-4 rounded-2xl border border-rose-500/20 md:border-rose-100 flex items-center gap-3 animate-pulse">
                  <span className="material-symbols-outlined text-lg">warning</span>
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <button 
                  type="submit"
                  disabled={isLoading || mfaCode.length !== 6}
                  className={`w-full py-5 rounded-2xl font-black text-sm uppercase tracking-widest text-white shadow-2xl flex items-center justify-center gap-4 transition-all active:scale-[0.97] ${
                    (isLoading || mfaCode.length !== 6) ? 'bg-blue-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-900/20 hover:shadow-emerald-900/40 hover:-translate-y-0.5'
                  }`}
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <>
                      Verifikasi & Masuk
                      <span className="material-symbols-outlined text-xl">verified_user</span>
                    </>
                  )}
                </button>
                
                <button 
                  type="button"
                  onClick={() => setShowMfaForm(false)}
                  className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-300 uppercase tracking-wider py-2"
                >
                  Batal & Kembali
                </button>
              </div>
            </form>
          )}

          <div className="pt-2 md:pt-4">
             <div className="p-5 bg-white/5 md:bg-slate-50 rounded-[2rem] border border-white/10 md:border-slate-100">
               <div className="flex items-center gap-2 mb-3">
                 <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
                 <p className="text-[10px] font-black text-slate-300 md:text-slate-400 uppercase tracking-widest">Informasi Penting</p>
               </div>
               <p className="text-[11px] font-bold text-slate-300 md:text-slate-600 leading-relaxed">
                 Gunakan email dinas yang sudah diverifikasi oleh Bid Tik. Jika belum memiliki akses, silakan hubungi pusat bantuan kami.
               </p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
