'use client';

import React, { useState } from 'react';
import { Play, RefreshCcw, RotateCw } from 'lucide-react';
import { CodeBlock, PageHeader, Panel, Segmented, ToolIntro } from './ui';

interface TaskLog {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'warn' | 'error' | 'success';
}

interface DeadLetterItem {
  id: string;
  taskName: string;
  failedAt: string;
  attempts: number;
  error: string;
  payload: Record<string, unknown>;
}

export function TaskSimulator() {
  const [backend, setBackend] = useState<'pg-boss' | 'bullmq'>('pg-boss');
  const [selectedTask, setSelectedTask] = useState<string>('SendWelcomeEmail');
  const [outcome, setOutcome] = useState<'success' | 'retry_then_succeed' | 'fail_to_dlq'>(
    'retry_then_succeed',
  );
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [logs, setLogs] = useState<TaskLog[]>([
    {
      id: 'log-1',
      time: '20:00:01',
      message: '[Pre-Flight] Worker #1: Database pool connected & warmed.',
      type: 'info',
    },
    {
      id: 'log-2',
      time: '20:00:02',
      message: '[Pre-Flight] Worker #1: Registered 3 tasks from src/tasks.',
      type: 'info',
    },
    {
      id: 'log-3',
      time: '20:00:03',
      message: '[Pre-Flight] Worker #1: HTTP listener active on port 3000.',
      type: 'success',
    },
  ]);
  const [deadLetters, setDeadLetters] = useState<DeadLetterItem[]>([
    {
      id: 'job_dlq_041',
      taskName: 'GeneratePdfInvoice',
      failedAt: '19:54:12',
      attempts: 4,
      error: 'RenderTimeoutError: Chromium crashed on page 4',
      payload: { invoiceId: 'inv_882', userId: 'usr_9' },
    },
  ]);

  const addLog = (message: string, type: 'info' | 'warn' | 'error' | 'success') => {
    const time = new Date().toTimeString().split(' ')[0];
    setLogs((prev) => [...prev, { id: Math.random().toString(), time, message, type }]);
  };

  const handleRunTask = () => {
    if (isProcessing) return;
    setIsProcessing(true);
    const jobId = 'job_' + Math.floor(Math.random() * 9000 + 1000);

    addLog(`[${backend}] Enqueued task "${selectedTask}" (ID: ${jobId})`, 'info');

    if (outcome === 'success') {
      setTimeout(() => {
        addLog(`[Worker] Started processing ${selectedTask} (${jobId})`, 'info');
      }, 500);

      setTimeout(() => {
        addLog(`[Worker] Completed ${selectedTask} successfully in 142ms`, 'success');
        setIsProcessing(false);
      }, 1200);
    } else if (outcome === 'retry_then_succeed') {
      setTimeout(() => {
        addLog(`[Worker] Attempt 1 failed for ${jobId}: Network timeout`, 'warn');
      }, 500);

      setTimeout(() => {
        addLog(`[Worker] Backing off 1.5s... Attempt 2 starting for ${jobId}`, 'info');
      }, 1200);

      setTimeout(() => {
        addLog(`[Worker] Attempt 2 succeeded! Job completed in 189ms`, 'success');
        setIsProcessing(false);
      }, 2000);
    } else {
      // Fail to DLQ
      setTimeout(() => {
        addLog(`[Worker] Attempt 1 failed for ${jobId}: Remote service unreachable`, 'warn');
      }, 500);

      setTimeout(() => {
        addLog(`[Worker] Attempt 2 failed for ${jobId}: Remote service unreachable`, 'warn');
      }, 1100);

      setTimeout(() => {
        addLog(`[Worker] Attempt 3 failed for ${jobId}: Remote service unreachable`, 'warn');
      }, 1800);

      setTimeout(() => {
        addLog(`[Worker] Attempt 4 failed. All 3 retries exhausted!`, 'error');
        addLog(`[DeadLetter] Job ${jobId} moved to Dead Letter Queue (DLQ)`, 'error');
        setDeadLetters((prev) => [
          {
            id: jobId,
            taskName: selectedTask,
            failedAt: new Date().toTimeString().split(' ')[0],
            attempts: 4,
            error: 'Remote service unreachable (HTTP 503)',
            payload: { email: 'client@company.com', triggeredAt: new Date().toISOString() },
          },
          ...prev,
        ]);
        setIsProcessing(false);
      }, 2400);
    }
  };

  const handleReplayDlq = (id: string) => {
    addLog(`[CLI] Executing: efc tasks retry ${id}`, 'info');
    setTimeout(() => {
      addLog(`[Worker] Replaying DLQ job ${id}...`, 'info');
    }, 400);
    setTimeout(() => {
      addLog(`[Worker] Replay for ${id} succeeded!`, 'success');
      setDeadLetters((prev) => prev.filter((item) => item.id !== id));
    }, 1100);
  };

  const taskCode = `import { defineTask } from 'express-file-cluster/tasks';

export default defineTask({
  retries: 3,
  backoff: 'exponential',${selectedTask === 'GeneratePdfInvoice' ? '\n  thread: true, // runs in worker_threads' : ''}${selectedTask === 'NightlyBackup' ? "\n  schedule: '0 2 * * *', // daily at 2am" : ''}
}, async (data) => {
  // The queue backend is chosen in ignite({ tasks: { backend } }).
});`;

  const enqueueCode = `import type { Request, Response } from 'express';
import { enqueue } from 'express-file-cluster/tasks';

export const POST = async (req: Request, res: Response) => {
  // ...create the user or invoice first...
  await enqueue('${selectedTask}', ${selectedTask === 'SendWelcomeEmail' ? "{ email: 'ada@example.com' }" : "{ invoiceId: 'inv_882' }"});
  res.status(202).json({ queued: true });
};`;

  const outcomes = [
    { value: 'success' as const, label: 'Succeeds on the first attempt' },
    { value: 'retry_then_succeed' as const, label: 'Fails once, retries, then succeeds' },
    {
      value: 'fail_to_dlq' as const,
      label: 'Fails every retry and lands in the dead-letter queue',
    },
  ];

  return (
    <>
      <PageHeader
        title="Tasks and workers"
        actions={
          <Segmented
            label="Queue backend"
            value={backend}
            onChange={setBackend}
            options={[
              { value: 'pg-boss', label: 'pg-boss · PostgreSQL' },
              { value: 'bullmq', label: 'BullMQ · Redis' },
            ]}
          />
        }
      >
        Background tasks run outside the request. Enqueue one, follow its attempts in the worker
        log, and replay whatever ends up in the dead-letter queue.
      </PageHeader>

      <ToolIntro
        chapterIds={['quest-4', 'quest-1']}
        steps={[
          <>
            Pick a task and an outcome on the left. Start with “Fails once, retries, then succeeds”.
          </>,
          <>
            Press <strong>Enqueue task</strong> and watch the worker log on the right fill in, one
            attempt at a time.
          </>,
          <>
            Now pick the last outcome and run it again. When every retry fails, the job lands in the{' '}
            <strong>dead-letter queue</strong> below the log.
          </>,
          <>
            Press <strong>Retry</strong> on a dead letter to replay it, like running{' '}
            <code>efc tasks retry</code> in a real project.
          </>,
        ]}
      >
        Some work is too slow to do while the user waits, like sending an email. Your route puts a
        job in a queue and answers right away; a worker picks the job up and runs it, retrying if it
        fails. This page simulates that; no queue or database is involved.
      </ToolIntro>

      <ol className="boot-steps" aria-label="Worker boot sequence">
        <li>
          <strong>
            <span>1</span> Primary forks
          </strong>
          <p>The primary process starts one worker per core.</p>
        </li>
        <li>
          <strong>
            <span>2</span> Database connects
          </strong>
          <p>Each worker opens its pool before any route is mounted.</p>
        </li>
        <li>
          <strong>
            <span>3</span> Tasks register
          </strong>
          <p>Files in src/tasks are scanned; cron schedules reconcile.</p>
        </li>
        <li>
          <strong>
            <span>4</span> Port opens
          </strong>
          <p>HTTP traffic is accepted only after the steps above finish.</p>
        </li>
      </ol>

      <div className="tool-grid">
        <div className="stack">
          <Panel title="Run a task">
            <div className="options-list">
              <label className="field">
                <span>Task</span>
                <select
                  className="select mono"
                  value={selectedTask}
                  onChange={(e) => setSelectedTask(e.target.value)}
                >
                  <option value="SendWelcomeEmail">SendWelcomeEmail · sends an email</option>
                  <option value="GeneratePdfInvoice">GeneratePdfInvoice · heavy CPU work</option>
                  <option value="NightlyBackup">NightlyBackup · runs on a schedule</option>
                </select>
              </label>
              <div className="field" role="radiogroup" aria-label="Outcome">
                <span>Outcome</span>
                <div className="radio-list">
                  {outcomes.map((o) => (
                    <label className="radio-option" key={o.value}>
                      <input
                        type="radio"
                        name="outcome"
                        checked={outcome === o.value}
                        onChange={() => setOutcome(o.value)}
                      />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                className="button button-primary"
                onClick={handleRunTask}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <RotateCw size={15} className="spin" /> Running…
                  </>
                ) : (
                  <>
                    <Play size={15} /> Enqueue task
                  </>
                )}
              </button>
            </div>
          </Panel>
          <Panel flush>
            <CodeBlock
              code={taskCode}
              label={`src/tasks/${selectedTask}.ts`}
              footer="The file name is the task name. retries: 3 means up to four attempts in total."
            />
          </Panel>
          {selectedTask !== 'NightlyBackup' && (
            <Panel flush>
              <CodeBlock
                code={enqueueCode}
                label="src/api/signup.ts · where the job comes from"
                footer="The route answers 202 Accepted right away; the worker does the slow part later."
              />
            </Panel>
          )}
        </div>

        <div className="stack">
          <Panel
            title="Worker log"
            flush
            actions={
              <button className="button button-quiet button-small" onClick={() => setLogs([])}>
                Clear
              </button>
            }
          >
            <div className="log" role="log" aria-live="polite">
              {logs.length === 0 ? (
                <div className="log-line">
                  <span />
                  <span>Idle. Enqueue a task to see it run.</span>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className={`log-line log-${log.type}`}>
                    <time>{log.time}</time>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Dead-letter queue" meta="efc tasks failed">
            {deadLetters.length === 0 ? (
              <div className="empty-state">
                <p>Empty. Nothing has failed past its retries.</p>
              </div>
            ) : (
              deadLetters.map((dlq) => (
                <div key={dlq.id} className="dlq-item">
                  <div className="dlq-head">
                    <span>
                      <code>{dlq.id}</code> <span className="header-chip">{dlq.taskName}</span>
                    </span>
                    <button
                      className="button button-quiet button-small"
                      onClick={() => handleReplayDlq(dlq.id)}
                    >
                      <RefreshCcw size={13} /> Retry
                    </button>
                  </div>
                  <p>
                    {dlq.error}. Failed after {dlq.attempts} attempts at {dlq.failedAt}.
                  </p>
                </div>
              ))
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
