export function hasNoteContent(node) {
  if (Array.isArray(node)) return node.some(hasNoteContent);
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'text') return typeof node.text === 'string' && /[^\s​﻿]/u.test(node.text);
  if (['media', 'image', 'video', 'audio'].includes(node.type)) return true;
  return Array.isArray(node.content) && node.content.some(hasNoteContent);
}
