// Demo API server with fake PII data
// Standalone Express server for testing the gateway

import express from 'express';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

app.use(express.json());

// In-memory data with fake PII
const users = [
  {
    id: '1',
    name: 'Alice Johnson',
    email: 'alice.johnson@example.com',
    phone: '+1-555-010-1234',
    ssn: '123-45-6789',
    plan: 'premium',
  },
  {
    id: '2',
    name: 'Bob Smith',
    email: 'bob.smith@example.com',
    phone: '+1-555-010-5678',
    ssn: '987-65-4321',
    plan: 'free',
  },
  {
    id: '3',
    name: 'Carol Williams',
    email: 'carol.williams@example.com',
    phone: '+1-555-010-9012',
    ssn: '456-78-9012',
    plan: 'premium',
  },
];

const orders = [
  {
    id: '101',
    userId: '1',
    items: [
      { sku: 'PROD-001', qty: 2, price: 29.99 },
      { sku: 'PROD-002', qty: 1, price: 49.99 },
    ],
    total: 109.97,
    cardNumber: '4111 1111 1111 1111', // Luhn-valid test number
  },
  {
    id: '102',
    userId: '2',
    items: [
      { sku: 'PROD-003', qty: 1, price: 19.99 },
    ],
    total: 19.99,
    cardNumber: '4111 1111 1111 1111',
  },
];

// Routes
app.get('/users', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  let result = users;
  if (limit) {
    result = result.slice(0, limit);
  }
  res.json(result);
});

app.post('/users', (req, res) => {
  const newUser = {
    id: String(users.length + 1),
    ...req.body,
  };
  users.push(newUser);
  res.status(201).json(newUser);
});

app.get('/users/:id', (req, res) => {
  const user = users.find(u => u.id === req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

app.delete('/users/:id', (req, res) => {
  const index = users.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  users.splice(index, 1);
  res.status(204).send();
});

app.get('/orders', (req, res) => {
  const userId = req.query.userId as string | undefined;
  let result = orders;
  if (userId) {
    result = result.filter(o => o.userId === userId);
  }
  res.json(result);
});

app.post('/orders', (req, res) => {
  const newOrder = {
    id: String(orders.length + 101),
    ...req.body,
    total: req.body.items.reduce((sum: number, item: any) => sum + item.qty * item.price, 0),
  };
  orders.push(newOrder);
  res.status(201).json(newOrder);
});

app.get('/orders/:id', (req, res) => {
  const order = orders.find(o => o.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  res.json(order);
});

// Start server when run directly
export function startDemoApi(port?: number): { close: () => void; port: number } {
  const actualPort = port || PORT;
  const server = app.listen(actualPort, () => {
    console.log(`Demo API listening on port ${actualPort}`);
  });

  return {
    close: () => {
      server.close();
    },
    port: actualPort,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startDemoApi();
}
