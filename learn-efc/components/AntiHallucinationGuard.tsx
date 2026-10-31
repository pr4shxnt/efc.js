'use client';

import React, { useState } from 'react';
import { AlertTriangle, ShieldCheck, Wand2 } from 'lucide-react';
import { PageHeader, Panel, ToolIntro } from './ui';
import { HALLUCINATION_RULES } from '../lib/efc-data';

export function AntiHallucinationGuard() {
  const [code, setCode] = useState<string>(`// Common Hallucinated EFC Code
import { ignite } from 'express-file-cluster';
import { db } from 'express-file-cluster/db'; // ❌ Does not exist!
import { createTask } from 'express-file-cluster/tasks'; // ❌ Does not exist!

async function start() {
  const server = await ignite({
    port: 3000,
    apiDir: 'src/routes', // ❌ apiDir is not an ignite option!
    plugins: [] // ❌ Plugins not yet implemented!
  });
}`);

  // Scan code against rules
  const detectedIssues = HALLUCINATION_RULES.filter((rule) => rule.pattern.test(code));

  const handleApplyFix = () => {
    let fixed = code;
    // Fix /db import
    fixed = fixed.replace("from 'express-file-cluster/db'", "from 'express-file-cluster'");
    fixed = fixed.replace('from "express-file-cluster/db"', "from 'express-file-cluster'");
    // Fix createTask -> defineTask
    fixed = fixed.replace(/createTask/g, 'defineTask');
    // Fix scheduleTask -> defineTask
    fixed = fixed.replace(/scheduleTask/g, 'defineTask');
    // Remove apiDir & tasksDir
    fixed = fixed.replace(/\s*apiDir:\s*['"][^'"]+['"],?/g, '');
    fixed = fixed.replace(/\s*tasksDir:\s*['"][^'"]+['"],?/g, '');
    // Remove plugins
    fixed = fixed.replace(/\s*plugins:\s*\[[^\]]*\],?/g, '');
    // Fix createModel -> defineModel
    fixed = fixed.replace(/createModel\(/g, 'defineModel(');

    setCode(fixed);
  };

  const samplePresets = [
    {
      label: 'Fake subpath + apiDir',
      code: `import { db } from 'express-file-cluster/db';
import { ignite } from 'express-file-cluster';

ignite({
  port: 8080,
  apiDir: 'src/controllers'
});`,
    },
    {
      label: 'createModel / createTask',
      code: `import { createModel } from 'express-file-cluster';
import { createTask } from 'express-file-cluster/tasks';

const User = createModel('User', { email: 'string' });
createTask('send-mail', async () => {});`,
    },
    {
      label: 'Mongo methods on defineTable',
      code: `import { defineTable } from 'express-file-cluster';

const User = defineTable('User', { id: { type: 'uuid' } });
// Calling MongoDB syntax on Postgres defineTable:
const user = await User.findById('123');`,
    },
    {
      label: 'Correct code',
      code: `import { ignite, db, defineTable } from 'express-file-cluster';
import { defineTask } from 'express-file-cluster/tasks';

// Reference-shaped EFC code (requires configured runtime)
const User = defineTable('User', {
  email: { type: 'string', unique: true }
});

const user = await User.findFirst({
  where: { email: 'dev@example.com' }
});

ignite({
  port: 3000,
  database: 'postgresql',
  databaseUrl: process.env.DATABASE_URL
});`,
    },
  ];

  const n = detectedIssues.length;
  return (
    <>
      <PageHeader
        title="API guard"
        actions={
          n > 0 && (
            <button className="button button-primary button-small" onClick={handleApplyFix}>
              <Wand2 size={14} /> Apply common fixes
            </button>
          )
        }
      >
        Paste EFC code, from an AI assistant or anywhere else, and catch imports, functions and
        options that don&apos;t exist. These are pattern checks, not a compiler.
      </PageHeader>

      <ToolIntro
        chapterIds={['quest-1']}
        steps={[
          <>Click one of the examples, or paste code from a tutorial or an AI assistant.</>,
          <>Read each problem on the right: what does not exist, and what to use instead.</>,
          <>
            Press <strong>Apply common fixes</strong> to rewrite the snippet, then check the list is
            empty.
          </>,
        ]}
      >
        Code you find online, or get from an AI, sometimes uses EFC features that were never real.
        This page catches the usual ones before you spend an hour on an error message.
      </ToolIntro>

      <div className="presets">
        <span>Examples</span>
        {samplePresets.map((preset) => (
          <button
            key={preset.label}
            className={`preset ${code === preset.code ? 'active' : ''}`}
            onClick={() => setCode(preset.code)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="tool-grid even">
        <Panel title="Snippet" meta="checked as you type" flush>
          <textarea
            className="editor"
            aria-label="Code to check"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={16}
            spellCheck={false}
            placeholder="Paste EFC code here"
          />
        </Panel>

        <div className="stack" aria-live="polite">
          {n === 0 ? (
            <div className="verdict verdict-ok">
              <ShieldCheck size={18} />
              <div>
                No known mistakes found
                <span> · still compile it and check signatures against the docs.</span>
              </div>
            </div>
          ) : (
            <div className="verdict verdict-bad">
              <AlertTriangle size={18} />
              <div>
                {n} problem{n > 1 ? 's' : ''} found
              </div>
            </div>
          )}

          {detectedIssues.map((issue) => (
            <div key={issue.badSnippet} className="issue">
              <p>{issue.reason}</p>
              <div className="diff">
                <div className="diff-bad">
                  <span>Doesn&apos;t exist</span>
                  {issue.badSnippet}
                </div>
                <div className="diff-good">
                  <span>Use instead</span>
                  {issue.goodSnippet}
                </div>
              </div>
            </div>
          ))}

          <Panel title="The only four import paths">
            <ul className="import-list">
              <li>
                <code>express-file-cluster</code>
                <span>ignite, models, db, cache, logger, errors</span>
              </li>
              <li>
                <code>express-file-cluster/auth</code>
                <span>tokens, sessions, requireAuth, password hashing</span>
              </li>
              <li>
                <code>express-file-cluster/tasks</code>
                <span>defineTask, enqueue</span>
              </li>
              <li>
                <code>express-file-cluster/testing</code>
                <span>createTestApp</span>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
