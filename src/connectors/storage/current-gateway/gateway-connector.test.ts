import { describe, expect, it } from 'vitest';

import { gatewayFormFlags } from '@/connectors/storage/current-gateway/gateway-connector';

describe('gatewayFormFlags', () => {
  it('keeps the legacy upload gateway form contract', () => {
    expect(gatewayFormFlags({ cdn: true, publicRead: false })).toEqual({ cdn: 'true', publicRead: '0' });
    expect(gatewayFormFlags({ cdn: false, publicRead: true })).toEqual({ cdn: 'false', publicRead: '1' });
  });
});
