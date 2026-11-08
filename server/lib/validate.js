import { HttpError } from './http.js';

export function text(value, max = 300, field = 'Field') {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') throw new HttpError(400, `${field} must be text`);
  const str = String(value).trim();
  if (str.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return str;
}

export function requiredText(value, max = 300, field = 'Field') {
  const str = text(value, max, field);
  if (!str) throw new HttpError(400, `${field} is required`);
  return str;
}

export function urlOrEmpty(value, field = 'URL') {
  const str = text(value, 500, field);
  if (!str) return '';
  if (!/^https?:\/\/\S+$/i.test(str)) throw new HttpError(400, `${field} must start with http:// or https://`);
  try {
    const parsed = new URL(str);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    return parsed.toString();
  } catch {
    throw new HttpError(400, `${field} is not a valid URL`);
  }
}

export function emailOrEmpty(value) {
  const str = text(value, 160, 'Email');
  if (!str) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) throw new HttpError(400, 'Email is not valid');
  return str;
}

export function intOrNull(value, { min = 0, max = 2_000_000_000, field = 'Value' } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new HttpError(400, `${field} must be a number between ${min} and ${max}`);
  }
  return Math.round(num);
}

export function enumValue(value, allowed, field = 'Value') {
  const str = text(value, 60, field);
  if (!allowed.includes(str)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return str;
}

export function boolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}
