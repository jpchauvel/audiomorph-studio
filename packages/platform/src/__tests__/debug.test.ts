import { describe, it } from 'vitest';

describe('Debug', () => {
  it('should log', () => {
    console.log('Test running');
    console.log('process.platform:', process.platform);
    console.log('process.arch:', process.arch);
    
    const mod = require('../index.ts');
    console.log('Module:', mod);
    console.log('getUserDataDir:', mod.getUserDataDir);
    if (mod.getUserDataDir) {
      console.log('Result:', mod.getUserDataDir());
    }
  });
});
