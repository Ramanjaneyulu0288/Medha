import { Platform } from 'react-native';

// Roasted Walnut & Champagne Taupe Palette
const tintColorLight = '#9C7248'; // Deep Warm Bronze
const tintColorDark = '#C59B6D';  // Glowing Amber Bronze

export const Colors = {
  light: {
    text: '#241D19',              // Dark Roast Walnut
    background: '#FBF9F7',        // Alabaster / Warm Canvas
    subtitle: '#766A61',          // Muted Warm Umber
    tint: tintColorLight,
    icon: '#A39488',              // Soft Warm Taupe
    tabIconDefault: '#A39488',
    tabIconSelected: tintColorLight,
    surface: '#F2ECE6',           // Silk Oat / Warm Cream
    border: '#E2D7CE',            // Smoked Parchment
    accent: '#9C7248',            // Deep Amber Bronze
    userBubble: '#9C7248',        // Bronze Pill
    userBubbleText: '#FFFFFF',    // Crisp White text
    assistantBubble: '#F2ECE6',   // Warm Silk Cream
    error: '#DC2626',
    success: '#16A34A',
  },
  dark: {
    text: '#F5EFEB',              // Champagne White
    background: '#1C1816',        // Roasted Walnut
    subtitle: '#9E9187',          // Muted Warm Taupe
    tint: tintColorDark,
    icon: '#8A7D73',              // Warm Taupe
    tabIconDefault: '#73675E',    // Deep Muted Taupe
    tabIconSelected: tintColorDark,
    surface: '#282320',           // Dark Cocoa
    border: '#3D3530',            // Smoked Umber
    accent: '#C59B6D',            // Glowing Amber Bronze
    userBubble: '#C59B6D',        // Glowing Amber Bronze
    userBubbleText: '#1C1816',    // Roasted Walnut Dark Text (High Contrast 7.5:1)
    assistantBubble: '#282320',   // Dark Cocoa
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
