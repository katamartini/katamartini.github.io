import fs from 'node:fs';

// Keep mocked writes independent of live match revisions and newly registered teams.
export function archiveSnapshot() {
  return JSON.parse(fs.readFileSync(new URL('../dlns/history.json',import.meta.url),'utf8'));
}

export function githubWriteFixture() {
  const archive=archiveSnapshot();
  return {...archive,teams:[{name:'Fixture EU Team',region:'EU'},{name:'Fixture NA Team',region:'NA'}]};
}
