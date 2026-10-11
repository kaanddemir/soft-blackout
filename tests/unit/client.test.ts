import { describe, expect, it } from 'vitest';
import { classifyInjectionError } from '../../src/ui/popup/client';

describe('injection error classification', () => {
  it('distinguishes restricted pages, lost access, and other injection failures', () => {
    expect(classifyInjectionError('Cannot access a chrome:// URL').code).toBe('RESTRICTED_PAGE');
    expect(classifyInjectionError('Cannot access contents of the page. Extension manifest must request permission.').code).toBe('LOST_PAGE_ACCESS');
    expect(classifyInjectionError('Frame was removed').code).toBe('INJECTION_FAILED');
  });
});
