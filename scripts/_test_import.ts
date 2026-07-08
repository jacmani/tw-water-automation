import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { extractSheetData } from '../src/lib/anthropic';
console.log('IMPORT OK', typeof extractSheetData);
