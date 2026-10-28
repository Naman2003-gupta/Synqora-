import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Boxes, CheckCircle2, Plus, RefreshCw, Server } from 'lucide-react';

const base = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

type Transaction = {
  id: string;
  status: string;
  attempts: number;
  sapReference: string | null;
  lastError: string | null;
  order: {
    orderNumber: string;
    customerId: string;
    totalAmount: string;
  };
};
type Order = {
  id: string;
  orderNumber: string;
  customerId: string;
  currency: string;
  totalAmount: string;
  status: string;
};
type DeadLetterJob = {
  id: string;
  transactionId: string;
  errorMessage: string;
  attempts: number;
  status: string;
};
type Stats = { orders: number; transactions: number; failed: number; completed: number };

export default function App() {
  const [tab, setTab] = useState('Overview');
  const [stats, setStats] = useState<Stats>({ orders: 0, transactions: 0, failed: 0, completed: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [jobs, setJobs] = useState<DeadLetterJob[]>([]);
  const [connected, setConnected] = useState(false);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    try {
      const [statsResponse, transactionsResponse, ordersResponse, jobsResponse, sapResponse] = await Promise.all([
        fetch(`${base}/dashboard/stats`),
        fetch(`${base}/transactions`),
        fetch(`${base}/orders`),
        fetch(`${base}/dead-letter`),
        fetch(`${base}/integrations/sap/health`),
      ]);
      if (![statsResponse, transactionsResponse, ordersResponse, jobsResponse].every((response) => response.ok)) {
        throw new Error('API is unavailable. Check the API and database services.');
      }

      const [nextStats, nextTransactions, nextOrders, nextJobs, sapHealth] = await Promise.all([
        statsResponse.json() as Promise<Stats>,
        transactionsResponse.json() as Promise<Transaction[]>,
        ordersResponse.json() as Promise<Order[]>,
        jobsResponse.json() as Promise<DeadLetterJob[]>,
        sapResponse.json() as Promise<{ connected: boolean }>,
      ]);
      setStats(nextStats);
      setTransactions(nextTransactions);
      setOrders(nextOrders);
      setJobs(nextJobs);
      setConnected(sapResponse.ok && sapHealth.connected);
    } catch (error) {
      setConnected(false);
      setMessage(error instanceof Error ? error.message : 'Unable to load integration data.');
    }
  }

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, []);

  async function createOrder() {
    try {
      const response = await fetch(`${base}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          customerId: 'DEMO-CUSTOMER',
          currency: 'USD',
          items: [{ productId: 'SKU-1', quantity: 2, unitPrice: 49.99 }],
        }),
      });
      if (!response.ok) throw new Error((await response.text()) || 'Order submission failed.');
      setMessage('Demo order submitted');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Order submission failed.');
    }
  }

  async function getAdminToken() {
    if (token) return token;
    const username = prompt('Admin username', 'admin');
    if (username === null) return null;
    const password = prompt('Admin password', 'admin123');
    if (password === null) return null;

    try {
      const response = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setMessage('Login failed. Check the admin credentials in .env.');
        return null;
      }
      const result = await response.json() as { token: string };
      setToken(result.token);
      return result.token;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Login failed.');
      return null;
    }
  }

  async function replay(path: string) {
    const adminToken = await getAdminToken();
    if (!adminToken) return;

    try {
      const response = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      setMessage(response.ok ? 'Retry queued' : `Retry unavailable (${response.status})`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Retry request failed.');
    }
  }

  const navigation = ['Overview', 'Transactions', 'Orders', 'Failed Jobs'];
  const metrics = [
    { label: 'Total Orders', value: stats.orders, Icon: Boxes },
    { label: 'Integration Events', value: stats.transactions, Icon: Activity },
    { label: 'Completed', value: stats.completed, Icon: CheckCircle2 },
    { label: 'Failed', value: stats.failed, Icon: AlertTriangle },
  ];

  return (
    <div className="shell">
      <aside>
        <div className="brand"><Boxes size={26} /> INTEGRATION<span>HUB</span></div>
        <div className="nav-label">WORKSPACE</div>
        {navigation.map((name) => (
          <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>
        ))}
        <div className="aside-bottom"><Server size={17} /> SAP Reliability Platform <small>Enterprise Demo v1.0</small></div>
      </aside>

      <main>
        <header>
          <div>
            <div className="eyebrow">OPERATIONS CENTER</div>
            <h1>{tab}</h1>
            <p>Monitor your SAP integrations in real time.</p>
          </div>
          <div className="actions">
            <span className={`pill ${connected ? 'green' : 'red'}`}>● SAP {connected ? 'Connected' : 'Offline'}</span>
            <button className="outline" onClick={() => void load()}><RefreshCw size={16} /> Refresh</button>
            <button className="primary" onClick={() => void createOrder()}><Plus size={17} /> New demo order</button>
          </div>
        </header>

        {message && <div className="notice" role="status" onClick={() => setMessage('')}>{message} ×</div>}

        {tab === 'Overview' && (
          <>
            <section className="cards">
              {metrics.map(({ label, value, Icon }) => (
                <div className="stat" key={label}>
                  <div className="stat-top"><span>{label}</span><Icon size={19} /></div>
                  <strong>{value}</strong>
                  <small>Live operational metric</small>
                </div>
              ))}
            </section>
            <div className="panel">
              <h2>Recent transactions</h2>
              <p>Latest SAP synchronization activity</p>
              <TransactionTable transactions={transactions.slice(0, 8)} retry={replay} />
            </div>
          </>
        )}

        {tab === 'Transactions' && (
          <div className="panel">
            <h2>All transactions</h2>
            <p>Processing attempts, SAP references and errors</p>
            <TransactionTable transactions={transactions} retry={replay} />
          </div>
        )}

        {tab === 'Orders' && (
          <div className="panel">
            <h2>Customer orders</h2>
            <table>
              <thead><tr><th>Order number</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {orders.length === 0
                  ? <tr><td colSpan={4} className="empty">No orders yet. Create a demo order to get started.</td></tr>
                  : orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.orderNumber}</td>
                      <td>{order.customerId}</td>
                      <td>{order.currency} {order.totalAmount}</td>
                      <td><span className="status">{order.status}</span></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'Failed Jobs' && (
          <div className="panel">
            <h2>Dead-letter jobs</h2>
            <p>Failed SAP submissions requiring investigation</p>
            <table>
              <thead><tr><th>Transaction</th><th>Error</th><th>Attempts</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {jobs.length === 0
                  ? <tr><td colSpan={5} className="empty">No dead-letter jobs.</td></tr>
                  : jobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.transactionId.slice(0, 8)}</td>
                      <td>{job.errorMessage}</td>
                      <td>{job.attempts}</td>
                      <td>{job.status}</td>
                      <td>{job.status === 'OPEN'
                        ? <button className="link" onClick={() => void replay(`/dead-letter/${job.id}/replay`)}>Replay</button>
                        : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function TransactionTable({
  transactions,
  retry,
}: {
  transactions: Transaction[];
  retry: (path: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>ORDER</th><th>CUSTOMER</th><th>STATUS</th><th>ATTEMPTS</th><th>SAP REFERENCE</th><th>ACTION</th></tr>
        </thead>
        <tbody>
          {transactions.length === 0
            ? <tr><td colSpan={6} className="empty">No transactions yet. Create a demo order to get started.</td></tr>
            : transactions.map((transaction) => (
              <tr key={transaction.id}>
                <td className="mono">{transaction.order.orderNumber.slice(0, 17)}</td>
                <td>{transaction.order.customerId}</td>
                <td><span className={`status ${transaction.status.toLowerCase()}`}>{transaction.status}</span></td>
                <td>{transaction.attempts}</td>
                <td className="mono">{transaction.sapReference || '—'}</td>
                <td>{transaction.status === 'FAILED'
                  ? <button className="link" onClick={() => void retry(`/transactions/${transaction.id}/retry`)}>Retry</button>
                  : '—'}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
