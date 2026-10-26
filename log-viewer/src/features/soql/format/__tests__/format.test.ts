/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ApexLexer } from '@apexdevtools/apex-parser';
import { describe, expect, it } from '@jest/globals';

import { formatSOQL } from '../formatter.js';
import { detectDialect, tokenize, type Dialect } from '../tokenize.js';

describe('SOQL/SOSL formatter', () => {
  describe('tokenize', () => {
    it('classifies SELECT/FROM/WHERE as keywords', () => {
      const tokens = tokenize('SELECT Id FROM Account WHERE x = 1').filter((t) => t.kind !== 'ws');
      expect(tokens.map((t) => t.kind)).toEqual([
        'keyword', // SELECT
        'ident', // Id
        'keyword', // FROM
        'ident', // Account
        'keyword', // WHERE
        'ident', // x
        'punct', // =
        'number', // 1
      ]);
    });

    it('classifies aggregate functions as function', () => {
      const tokens = tokenize('SELECT COUNT(Id) FROM Account').filter((t) => t.kind !== 'ws');
      const count = tokens.find((t) => t.text === 'COUNT');
      expect(count?.kind).toBe('function');
    });

    it('classifies every SOQL and SOSL word the apex-parser lexer knows', () => {
      const apexOnly = new Set(
        `ABSTRACT AFTER AS BEFORE BREAK CATCH CLASS CONTINUE DELETE DO ENUM EXTENDS FINAL FINALLY
        GET GLOBAL IF IMPLEMENTS INHERITED INSERT INSTANCEOF INTERFACE LIST MAP MERGE NEW ON
        OVERRIDE PRIVATE PROTECTED PUBLIC RETURN SHARING STATIC SUPER SWITCH SYSTEM TESTMETHOD
        THIS THROW TRANSIENT TRIGGER TRY UNDELETE UPSERT USER VIRTUAL VOID WEBSERVICE WHILE
        WITHOUT`.split(/\s+/),
      );
      const isClassified = (word: string, dialect: Dialect): boolean =>
        ['keyword', 'function'].includes(tokenize(word, dialect)[0]!.kind);

      const unclassified = ApexLexer.literalNames
        .map((name) => name?.slice(1, -1).toUpperCase() ?? '')
        .filter((word) => /^[A-Z_]+$/.test(word) && !apexOnly.has(word))
        .filter((word) => !isClassified(word, 'soql') && !isClassified(word, 'sosl'));
      expect(unclassified).toEqual([]);
    });

    it('classifies SOSL-only clause words as keywords in SOSL', () => {
      const words = ['UPDATE', 'VIEWSTAT', 'SPELL_CORRECTION', 'PRICEBOOKID', 'USER_MODE', 'DESC'];
      const kinds = words.map((word) => tokenize(word, 'sosl')[0]!.kind);
      expect(kinds).toEqual(words.map(() => 'keyword'));
    });

    it('recognises bind variables', () => {
      const tokens = tokenize('SELECT Id FROM Account WHERE Name = :name').filter(
        (t) => t.kind !== 'ws',
      );
      expect(tokens[tokens.length - 1]).toEqual({ kind: 'bind', text: ':name' });
    });

    it('keeps single-quoted strings intact including escapes', () => {
      const tokens = tokenize("Name = 'O\\'Brien'").filter((t) => t.kind !== 'ws');
      const str = tokens.find((t) => t.kind === 'string');
      expect(str?.text).toBe("'O\\'Brien'");
    });

    it('handles SOSL { } search terms as strings', () => {
      const tokens = tokenize('FIND {acme} RETURNING Account', 'sosl').filter(
        (t) => t.kind !== 'ws',
      );
      expect(tokens[1]).toEqual({ kind: 'string', text: '{acme}' });
    });
  });

  describe('detectDialect', () => {
    it('flags FIND as sosl', () => {
      expect(detectDialect('  FIND {x} RETURNING Account')).toBe('sosl');
    });
    it('defaults to soql', () => {
      expect(detectDialect('SELECT Id FROM Account')).toBe('soql');
    });
  });

  describe('formatSOQL inline', () => {
    it('returns empty string for empty input', () => {
      expect(formatSOQL('', { mode: 'inline' })).toBe('');
    });

    it('wraps SELECT in keyword span', () => {
      const html = formatSOQL('SELECT Id FROM Account', { mode: 'inline' });
      expect(html).toContain('<span class="soql-tok-keyword">SELECT</span>');
      expect(html).toContain('<span class="soql-tok-keyword">FROM</span>');
    });

    it('escapes HTML in identifiers', () => {
      const html = formatSOQL('SELECT a<b> FROM x', { mode: 'inline' });
      expect(html).not.toContain('<b>');
      expect(html).toContain('&lt;');
      expect(html).toContain('&gt;');
    });

    it('auto-detects SOSL', () => {
      const html = formatSOQL('FIND {acme} RETURNING Account', { mode: 'inline', dialect: 'auto' });
      expect(html).toContain('<span class="soql-tok-keyword">FIND</span>');
      expect(html).toContain('<span class="soql-tok-keyword">RETURNING</span>');
      expect(html).toContain('<span class="soql-tok-string">{acme}</span>');
    });
  });

  describe('formatSOQL pretty', () => {
    it('breaks before major clauses', () => {
      const html = formatSOQL('SELECT Id FROM Account WHERE x = 1 LIMIT 10', { mode: 'pretty' });
      const lines = html.split('\n');
      expect(lines[0]).toContain('>SELECT<');
      expect(lines[1]).toMatch(/^<span class="soql-tok-keyword">FROM<\/span>/);
      expect(lines[2]).toMatch(/^<span class="soql-tok-keyword">WHERE<\/span>/);
      expect(lines[3]).toMatch(/^<span class="soql-tok-keyword">LIMIT<\/span>/);
    });

    it('starts SET OPTIONS on its own line', () => {
      const html = formatSOQL(
        "SELECT Id FROM Account LIMIT 10 SET OPTIONS (dataspace = 'default', honorEmptyStrings = true)",
        { mode: 'pretty' },
      );
      const lines = html.split('\n');
      expect(lines[2]).toMatch(
        /^<span class="soql-tok-keyword">LIMIT<\/span> <span[^>]*>10<\/span>$/,
      );
      expect(lines[3]).toMatch(
        /^<span class="soql-tok-keyword">SET<\/span> <span class="soql-tok-keyword">OPTIONS<\/span>/,
      );
    });

    it('starts UPDATE TRACKING on its own line, but keeps FOR UPDATE on one line', () => {
      const tracking = formatSOQL('SELECT Id FROM KnowledgeArticleVersion UPDATE TRACKING', {
        mode: 'pretty',
      }).split('\n');
      expect(tracking[2]).toMatch(/^<span class="soql-tok-keyword">UPDATE<\/span>/);

      const locking = formatSOQL('SELECT Id FROM Account FOR UPDATE', { mode: 'pretty' }).split(
        '\n',
      );
      expect(locking).toHaveLength(3);
      expect(locking[2]).toContain('>FOR<');
      expect(locking[2]).toContain('>UPDATE<');
    });

    it('breaks AND/OR onto new lines inside WHERE', () => {
      const html = formatSOQL('SELECT Id FROM A WHERE x=1 AND y=2 OR z=3', { mode: 'pretty' });
      const lines = html.split('\n');
      const andLine = lines.find((l) => l.includes('>AND<'));
      const orLine = lines.find((l) => l.includes('>OR<'));
      expect(andLine).toBeDefined();
      expect(orLine).toBeDefined();
      expect(andLine!.startsWith('  ')).toBe(true);
      expect(orLine!.startsWith('  ')).toBe(true);
    });

    it('indents subqueries', () => {
      const html = formatSOQL('SELECT Id, (SELECT Id FROM Contacts) FROM Account', {
        mode: 'pretty',
      });
      expect(html).toContain('\n  <span class="soql-tok-keyword">SELECT</span>');
      expect(html).toContain('\n  <span class="soql-tok-keyword">FROM</span>');
    });

    it('does not break before function-call parens', () => {
      const html = formatSOQL('SELECT COUNT(Id) FROM Account', { mode: 'pretty' });
      expect(html).toMatch(/COUNT<\/span>\s*<span class="soql-tok-punct">\(/);
      expect(html).not.toMatch(/COUNT<\/span>\s+<span class="soql-tok-punct">\(/);
    });

    it('does not emit a blank line between ( and inner SELECT', () => {
      const html = formatSOQL('SELECT Id, (SELECT Id FROM Contacts) FROM Account', {
        mode: 'pretty',
      });
      expect(html).not.toMatch(/\n\s*\n/);
    });

    it('never throws on malformed input', () => {
      expect(() => formatSOQL("SELECT 'unterminated FROM x", { mode: 'pretty' })).not.toThrow();
      expect(() => formatSOQL('((((((', { mode: 'pretty' })).not.toThrow();
      expect(() => formatSOQL('<script>', { mode: 'inline' })).not.toThrow();
      const safe = formatSOQL('<script>alert(1)</script>', { mode: 'inline' });
      expect(safe).not.toContain('<script>');
    });
  });
});
