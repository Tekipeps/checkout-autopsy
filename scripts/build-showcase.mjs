import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
execFileSync('npm', ['run', 'check'], { stdio: 'inherit' });
execFileSync('npx', ['--no-install', 'vite', 'build', '--config', 'vite.showcase.config.ts'], { stdio: 'inherit' });
renameSync('dist-showcase/showcase/index.html', 'dist-showcase/index.html');
rmSync('dist-showcase/showcase', { recursive: true });
mkdirSync('dist-showcase/evidence', { recursive: true });
for (const name of ['node-postgres-full.json', 'python-challenge-full.json', 'node-postgres.json']) copyFileSync(`docs/evidence/${name}`, `dist-showcase/evidence/${name}`);
