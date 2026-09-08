import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { SessionProvider } from '@/api/session';
import { createQueryClient } from '@/api/query-client';
import { Root } from '@/Root';

function Bootstrap() {
  const [queryClient] = useState(createQueryClient);

  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#07865F' } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter basename="/admin">
            <SessionProvider>
              <Root />
            </SessionProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
