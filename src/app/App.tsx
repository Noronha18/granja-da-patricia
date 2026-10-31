import {lazy,Suspense,useEffect,useRef,useState,type FormEvent} from 'react';
import {supabase} from '../lib/supabase';
import {useSession} from './Session';
const CustomersPage=lazy(()=>import('../features/customers/CustomersPage'));
const OrdersPage=lazy(()=>import('../features/orders/OrdersPage'));
const RoutesPage=lazy(()=>import('../features/routes/RoutesPage'));
const SettingsPage=lazy(()=>import('../features/settings/SettingsPage'));
const ImportPage=lazy(()=>import('../features/customers/ImportPage'));
const StockPage=lazy(()=>import('../features/stock/StockPage'));
const FinancePage=lazy(()=>import('../features/finance/FinancePage'));
const PaymentsPage=lazy(()=>import('../features/finance/PaymentsPage'));
const DashboardPage=lazy(()=>import('../features/dashboard/DashboardPage'));
const DriverPage=lazy(()=>import('../features/driver/DriverPage'));
const FuelPage=lazy(()=>import('../features/fuel/FuelPage'));
const PendingReturnsPage=lazy(()=>import('../features/routes/PendingReturnsPage'));
const ownerLinks=[['/','Início'],['/clientes','Clientes'],['/pedidos','Pedidos'],['/entregas','Entregas'],['/financeiro','Financeiro'],['/estoque','Estoque'],['/combustivel','Combustível'],['/configuracoes','Configurações']];
export default function App(){
 const {role,loading,notice}=useSession();const [path,setPath]=useState(location.pathname),[error,setError]=useState(''),[busy,setBusy]=useState(false),[more,setMore]=useState(false);
 const morePanel=useRef<HTMLElement>(null),moreButton=useRef<HTMLButtonElement>(null),wasMore=useRef(false);
 useEffect(()=>{if(more)morePanel.current?.querySelector('a')?.focus();else if(wasMore.current)moreButton.current?.focus();wasMore.current=more;function escape(event:KeyboardEvent){if(event.key==='Escape')setMore(false);}if(more)document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[more]);
 useEffect(()=>{if(loading)return;const target=!role?'/login':path==='/login'?(role==='driver'?'/entregas':'/'):path;if(target!==path){history.replaceState(null,'',target);setPath(target);}},[role,loading,path]);
 async function login(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const form=new FormData(event.currentTarget);const {error}=await supabase.auth.signInWithPassword({email:String(form.get('email')),password:String(form.get('password'))});if(error)setError('Não foi possível entrar. Confira e-mail e senha.');setBusy(false);}
 async function logout(){window.dispatchEvent(new CustomEvent('granja:logout',{detail:true}));const {error}=await supabase.auth.signOut({scope:'local'});window.dispatchEvent(new CustomEvent('granja:logout',{detail:false}));if(error)setError('Não foi possível sair. Tente novamente.');}
 function page(){
  if(path==='/combustivel')return <FuelPage/>;
  if(role==='driver'){if(path==='/'||path==='/entregas')return <DriverPage/>;return <section><h1>Acesso não permitido</h1><p>Seu perfil permite executar sua rota e registrar abastecimentos.</p></section>;}
  switch(path){case '/':return <DashboardPage/>;case '/clientes':return <CustomersPage/>;case '/pedidos':return <OrdersPage/>;case '/entregas':return <RoutesPage/>;case '/financeiro':return <FinancePage/>;case '/pagamentos':return <PaymentsPage/>;case '/estoque':return <StockPage/>;case '/configuracoes':return <SettingsPage/>;case '/importar-clientes':return <ImportPage/>;case '/conferencias':return <PendingReturnsPage/>;default:return <section><h1>Página não encontrada</h1><a href="/">Voltar ao início</a></section>;}
 }
 if(loading)return <main><p role="status">Verificando acesso…</p></main>;
 const links=role==='driver'?[['/entregas','Minha rota'],['/combustivel','Combustível']]:ownerLinks;
 return <main className={role?`authenticated-app ${role==='driver'?'driver-app':'owner-app'}`:''}><header className="app-header"><p className="brand">Granja da Patrícia</p>{role&&<button className="secondary" onClick={logout}>Sair</button>}</header>
 {!role&&(notice||error)&&<p role="alert">{error||notice}</p>}
 {!role?<section className="login"><h1>Entrar</h1><p>Acesso por convite da dona.</p><form onSubmit={login}><label>E-mail<input name="email" type="email" autoComplete="username" required/></label><label>Senha<input name="password" type="password" autoComplete="current-password" required/></label><button disabled={busy}>{busy?'Entrando…':'Entrar'}</button></form><details className="login-recovery"><summary>Precisa recuperar o acesso?</summary><h2>Motorista</h2><p>Solicite recuperação à dona da granja.</p><h2>Dona ou administrador</h2><p>Procure o responsável técnico que cadastrou seu acesso para confirmar sua identidade e redefinir a senha com segurança. Esta tela ainda não envia e-mail de recuperação.</p></details></section>:<>
 <nav className="desktop-nav" aria-label="Navegação principal">{links.map(([href,label])=><a key={href} href={href} aria-current={path===href||(href==='/entregas'&&role==='driver'&&path==='/')?'page':undefined}>{label}</a>)}</nav>
 <div className="app-workspace">{(notice||error)&&<p role="alert">{error||notice}</p>}<Suspense fallback={<p role="status">Carregando tela…</p>}>{page()}</Suspense></div>
 {more&&role==='owner'&&<nav ref={morePanel} id="owner-more-options" className="mobile-more" aria-label="Mais opções"><h2>Mais opções</h2>{ownerLinks.filter(([href])=>!['/','/pedidos','/entregas'].includes(href)).map(([href,label])=><a key={href} href={href}>{label}</a>)}<button className="secondary" onClick={()=>setMore(false)}>Fechar opções</button></nav>}
 <nav className="mobile-nav" aria-label="Navegação no celular">{role==='owner'?<><a href="/" aria-current={path==='/'?'page':undefined}>Início</a><a href="/pedidos" aria-current={path==='/pedidos'?'page':undefined}>Pedidos</a><a href="/entregas" aria-current={path==='/entregas'?'page':undefined}>Entregas</a><button ref={moreButton} className="secondary" aria-controls="owner-more-options" aria-expanded={more} onClick={()=>setMore(value=>!value)}>Mais</button></>:<><a href="/entregas" aria-current={path==='/'||path==='/entregas'?'page':undefined}>Minha rota</a><a href="/combustivel" aria-current={path==='/combustivel'?'page':undefined}>Combustível</a></>}</nav>
 </>}
 </main>;
}
