import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { hadStoredSession, supabase } from '../lib/supabase';

type Access = { userId: string | null; role: 'owner' | 'driver' | null; loading: boolean; notice: string };
const empty = { userId: null, role: null, loading: true, notice: '' } as const;
const Context = createContext<Access>(empty);
export function Session({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>(empty);
  useEffect(() => {
    let active = true;
    let version = 0;
    let authorized = false;
    let currentUserId: string | null = null;
    let intentionalLogout = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const attempt = ++version;
      if (!session) {
        const expired = !intentionalLogout && (authorized || (event === 'INITIAL_SESSION' && hadStoredSession));
        authorized = false;
        currentUserId = null;
        setAccess({ userId: null, role: null, loading: false, notice: expired ? 'Sessão expirada. Entre novamente.' : '' });
        return;
      }
      intentionalLogout = false;
      if (currentUserId !== session.user.id) {
        currentUserId = session.user.id;
        authorized = false;
        setAccess({ ...empty });
      }
      // Leave the auth callback before calling another Supabase auth method.
      setTimeout(async () => {
        const { data, error } = await supabase.auth.getUser();
        if (!active || attempt !== version) return;
        if (error || !data.user) {
          authorized = false; currentUserId = null;
          setAccess({ userId: null, role: null, loading: false, notice: 'Sessão expirada. Entre novamente.' });
          return;
        }
        const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
        if (!active || attempt !== version) return;
        if (profileError || !profile || (profile.role !== 'owner' && profile.role !== 'driver')) {
          authorized = false; currentUserId = null;
          setAccess({ userId: null, role: null, loading: false, notice: profileError ? 'Não foi possível verificar seu acesso. Tente novamente.' : 'Acesso não autorizado. Solicite um convite à dona.' });
          return;
        }
        authorized = true;
        setAccess({ userId: data.user.id, role: profile.role, loading: false, notice: '' });
      }, 0);
    });
    const onLogout = (event: Event) => { intentionalLogout = (event as CustomEvent<boolean>).detail; };
    window.addEventListener('granja:logout', onLogout);
    return () => { active = false; version++; subscription.unsubscribe(); window.removeEventListener('granja:logout', onLogout); };
  }, []);
  return <Context.Provider value={access}>{children}</Context.Provider>;
}
export const useSession = () => useContext(Context);
