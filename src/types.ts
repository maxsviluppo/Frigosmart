export interface Product {
  id: string;
  userId: string;
  name: string;
  expiryDate: string; // YYYY-MM-DD
  addedDate: string; // ISO
  category: string;
  consumed: boolean;
  customReminderDays?: number; // Days before expiry for custom reminder
  notes?: string;
}

export interface ShoppingItem {
  id: string;
  userId: string;
  name: string;
  category: string;
  checked: boolean;
  source: 'recipe' | 'finished' | 'manual';
  addedDate: string;
}

export type AppView = 'list' | 'camera' | 'confirm' | 'settings' | 'shopping';

export interface NotificationSettings {
  daysBefore: number;
  enabledCategories: string[];
  geminiApiKey?: string;
  allCategories?: string[];
}
