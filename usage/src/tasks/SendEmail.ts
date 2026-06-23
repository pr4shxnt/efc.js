import { defineTask } from 'express-file-cluster/tasks';

interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
}

export default defineTask<SendEmailPayload>(async ({ to, subject, body }) => {
  console.log('[SendEmail] Sending to', to);
  console.log('[SendEmail] Subject:', subject);
  console.log('[SendEmail] Body:', body);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log('[SendEmail] Sent to', to);
});
