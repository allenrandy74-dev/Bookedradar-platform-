import { main } from './scripts/backup.js';
main().then(result => console.log(JSON.stringify(result))).catch(() => { console.error('Backup operation failed; check backup configuration and destination.'); process.exitCode = 1; });
