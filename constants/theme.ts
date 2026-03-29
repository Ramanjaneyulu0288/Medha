import { Platform } from 'react-native';

const tintColorLight = '#6366F1'; // Indigo 500
const tintColorDark = '#A78BFA';  // Violet 400

export const Colors = {
  light: {
    text: '#1E293B',
    background: '#F8FAFC',
    subtitle: '#64748B',
    tint: tintColorLight,
    icon: '#94A3B8',
    tabIconDefault: '#94A3B8',
    tabIconSelected: tintColorLight,
    surface: '#FFFFFF',
    border: '#E2E8F0',
    accent: '#8B5CF6',
    userBubble: '#6366F1',
    assistantBubble: '#F1F5F9',
    error: '#EF4444',
    success: '#10B981',
  },
  dark: {
    text: '#F8FAFC',
    background: '#0F172A', // Deep Slate 900
    subtitle: '#94A3B8',
    tint: tintColorDark,
    icon: '#475569',
    tabIconDefault: '#475569',
    tabIconSelected: tintColorDark,
    surface: '#1E293B', // Slate 800
    border: '#334155',
    accent: '#8B5CF6',
    userBubble: '#8B5CF6', // Electric Violet
    assistantBubble: '#1E293B',
    error: '#F87171',
    success: '#34D399',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'System',
    mono: 'Courier New',
  },
  android: {
    sans: 'sans-serif-medium',
    mono: 'monospace',
  },
  default: {
    sans: 'normal',
    mono: 'monospace',
  },
});
