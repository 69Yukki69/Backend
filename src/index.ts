import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ENV } from './config/env';
import employeeRoute from './routes/employee.routes';
import supplierRoute from './routes/supplier.route';
import customerRoute from './routes/customer.routes';
import productRoute from './routes/product.routes';

const app = express();

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'https://my-app-phi-pearl-24.vercel.app',  // ← exact Vercel URL
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ✅ Handle preflight requests
app.options('*', cors());

app.use(express.json());

app.use('/api/employees', employeeRoute);
app.use('/api/suppliers', supplierRoute);
app.use('/api/customers', customerRoute);
app.use('/api/products', productRoute);

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.listen(ENV.PORT || 5000, () => {
  console.log(`Server running on port ${ENV.PORT || 5000}`);
});