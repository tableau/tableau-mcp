import express from 'express';
import path from 'path';

import { getDirname } from '../../../utils/getDirname';

export function setupUiRoutes(app: express.Application): void {
  app.get('/embed', (_, res) => {
    res.set('Content-Type', 'text/html');
    res.sendFile(path.join(getDirname(), 'server/ui/views/embed/index.html'));
  });
}
