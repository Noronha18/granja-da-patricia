import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const [command, identity, role] = process.argv.slice(2);
if (!['create', 'recover', 'list'].includes(command)) throw Error('Use create EMAIL owner|driver, recover UUID, or list');
const local = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
if (local.API_URL !== 'http://127.0.0.1:56321') throw Error('Only the isolated Granja local stack is allowed');
const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
if (command === 'list') {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw Error('Could not list local users');
  for (const user of data.users) console.log(user.id, user.email);
} else {
  const password = process.env.TEMPORARY_PASSWORD;
  if (!password || password.length < 12) throw Error('TEMPORARY_PASSWORD must contain at least 12 characters');
  if (command === 'create') {
    if (!identity || !['owner', 'driver'].includes(role)) throw Error('Use create EMAIL owner|driver');
    const { data, error } = await admin.auth.admin.createUser({ email: identity, password, email_confirm: true });
    if (error || !data.user) throw Error('Could not create local user');
    const { error: profileError } = await admin.from('profiles').insert({ id: data.user.id, role });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throw Error('Could not assign profile; new local user removed');
    }
    console.log('Local user created:', data.user.id, role);
  } else {
    if (!identity) throw Error('Use recover UUID');
    const { error } = await admin.auth.admin.updateUserById(identity, { password });
    if (error) throw Error('Could not recover local user');
    console.log('Local password updated. Existing access tokens expire according to Auth policy.');
  }
}
