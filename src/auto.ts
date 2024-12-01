import './core/instrumentation/init';
import { scan, scanWithRecord, flush } from './index';

if (typeof window !== 'undefined') {
  // scan();
  scanWithRecord();

  // @ts-expect-error
  window.flush = flush;
  window.reactScan = scan;
}

export * from './index';
