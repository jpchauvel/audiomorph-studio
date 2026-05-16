import { getUserDataDir, getPlatform } from './dist/index.js';

console.log('Platform:', getPlatform());
console.log('UserDataDir:', getUserDataDir());
console.log('Type:', typeof getUserDataDir());
