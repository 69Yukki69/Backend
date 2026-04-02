import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ENV } from './config/env';
import employeeRoute from './routes/employee.routes';
import supplierRoute from './routes/supplier.route';
import customerRoute from './routes/customer.routes';
import productRoute from './routes/product.routes';

const app = express();

const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'https://my-app-phi-pearl-24.vercel.app',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions)); // ← no app.options('*') needed

app.use(express.json());

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use('/api/employees', employeeRoute);
app.use('/api/suppliers', supplierRoute);
app.use('/api/customers', customerRoute);
app.use('/api/products', productRoute);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK' });
});

app.listen(ENV.PORT || 5000, () => {
  console.log(`Server running on port ${ENV.PORT || 5000}`);
});