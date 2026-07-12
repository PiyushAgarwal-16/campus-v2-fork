import { adminService } from './services/adminService.js';

async function main() {
  try {
    console.log('Querying admin reports list...');
    const result = await adminService.reportQueue(['open'], undefined, 10);
    console.log('Admin reports result:');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error listing reports:', err);
    process.exit(1);
  }
}

main();
