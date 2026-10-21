import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const url = 'https://urwhknxbumwjcuplfwni.supabase.co/rest/v1';
const headers = {apikey:'sb_publishable_WnP1QNaJOLB5wtHQ2krzQw_NyoZVXLn','Content-Type':'application/json'};
const history = JSON.parse(await fs.readFile(new URL('../dlns/history.json',import.meta.url),'utf8'));
const response = await fetch(`${url}/dlns_matches?select=*&limit=1000`,{headers});
assert.equal(response.status,200);
const matches = await response.json();
assert.ok(matches.length >= history.matches.length);
for (const original of history.matches) {
  const actual = matches.find(match=>match.match_id === original.match_id);
  assert.ok(actual,original.match_id);
  for (const key of ['week','region','round','game','left_team','right_team','first_pick','winner','actions']) {
    assert.deepEqual(actual[key],original[key],`${original.match_id}: ${key}`);
  }
}
const admin = await fetch(`${url}/rpc/dlns_is_admin`,{method:'POST',headers,body:'{}'});
assert.equal(admin.status,200);
assert.equal(await admin.json(),false);
for (const [path,body] of [
  ['/rpc/dlns_save_match',{p_match:history.matches[0]}],
  ['/dlns_matches',history.matches[0]],
  ['/rpc/dlns_add_team',{p_name:'Not Allowed',p_region:'EU'}],
  ['/dlns_teams',{name:'Not Allowed',region:'EU'}]
]) {
  const denied = await fetch(url+path,{method:'POST',headers,body:JSON.stringify(body)});
  assert.ok([401,403].includes(denied.status),`${path} must reject anonymous writes (${denied.status})`);
}
const teams = await fetch(`${url}/dlns_teams?select=region,name&limit=1000`,{headers});
assert.equal(teams.status,200,'Registered teams must be publicly readable');
assert.ok(Array.isArray(await teams.json()));
const audit = await fetch(`${url}/dlns_match_revisions?select=*&limit=1`,{headers});
assert.ok([401,403].includes(audit.status),'Revision history must not be public');
console.log(`DLNS live: ${matches.length} matches readable; imported content unchanged; anonymous writes and revision access denied.`);
