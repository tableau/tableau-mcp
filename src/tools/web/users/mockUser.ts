import { User } from '../../../sdks/tableau/types/user.js';

export const mockUser: User = {
  id: 'user-abc123',
  name: 'jsmith',
  siteRole: 'Creator',
  email: 'john.smith@example.com',
  fullName: 'John Smith',
  lastLogin: '2026-05-20T10:30:00Z',
  authSetting: 'SAML',
  locale: 'en_US',
  language: 'en',
};
