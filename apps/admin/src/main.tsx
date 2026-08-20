import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { SessionProvider } from '@/api/session';
import { createQueryClient } from '@/api/query-client';
import { Root } from '@/Root';

function Bootstrap() {
  const [expiredAt, setExpiredAt] = useState(0);
  // 会话失效时换一个 QueryClient，等于把所有在途请求与缓存一起丢掉。
  const queryClient = useMemo(
    () => createQueryClient(() => setExpiredAt(Date.now())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expiredAt],
  );

  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#07865F' } }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
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
