import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
const admin=createClient(process.env.VITE_SUPABASE_URL!,process.env.TEST_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const email=`maps-${Date.now()}@example.test`,password='Maps-fixture-only-2026!';let actor='',route='';
test.beforeAll(async()=>{
 const user=await admin.auth.admin.createUser({email,password,email_confirm:true});if(user.error)throw user.error;actor=user.data.user!.id;
 if((await admin.from('profiles').insert({id:actor,role:'owner'})).error)throw Error('fixture profile');
 const template=await admin.from('route_templates').select('id').limit(1).single();
 const run=await admin.from('route_runs').insert({template_id:template.data!.id,service_date:'2097-08-12'}).select('id').single();if(run.error)throw run.error;route=run.data.id;
});
test.afterAll(async()=>{
 if(route){if((await admin.from('route_runs').delete().eq('id',route)).error)throw Error('fixture route cleanup');}
 if(actor&& (await admin.auth.admin.deleteUser(actor)).error)throw Error('fixture actor cleanup');
});
test('owner sees estimate and provider failure does not block route preparation',async({page})=>{
 await page.setViewportSize({width:390,height:900});await page.goto('/login');await page.getByLabel('E-mail').fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar',exact:true}).click();await expect(page.getByRole('button',{name:'Sair'})).toBeVisible();await page.goto('/entregas?dia=2097-08-12');
 await page.route('**/api/routes/*/distance',request=>request.fulfill({status:200,json:{distanceMetres:12300,durationSeconds:1800,routeVersion:1,calculatedAt:'2026-10-29T18:00:00Z'}}));
 await page.getByRole('button',{name:'Calcular percurso',exact:true}).click();await expect(page.getByRole('status')).toContainText('12,3 km');await expect(page.getByRole('link',{name:'Powered by Geoapify'})).toBeVisible();
 await page.screenshot({path:'/tmp/granja-geoapify-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'/tmp/granja-geoapify-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:900});
 await page.unroute('**/api/routes/*/distance');await page.route('**/api/routes/*/distance',request=>request.fulfill({status:503,json:{error:'MAPS_NOT_CONFIGURED'}}));
 await page.getByRole('button',{name:'Calcular percurso',exact:true}).click();await expect(page.getByRole('alert')).toContainText('chave gratuita');await expect(page.getByText('12,3 km',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Salvar preparação da rota',exact:true})).toBeEnabled();
 await page.getByLabel('Motorista da rota').selectOption('');await expect(page.getByRole('button',{name:'Calcular percurso',exact:true})).toBeDisabled();
});
