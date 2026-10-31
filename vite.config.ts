import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { receiptApiPlugin } from './src/server/dev';
export default defineConfig({ plugins: [react(),receiptApiPlugin()], test: { include: ['src/**/*.test.ts'] } });
