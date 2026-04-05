import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ENV } from './config/env';
import employeeRoute from './routes/employee.routes';
import supplierRoute from './routes/supplier.route';
import customerRoute from './routes/customer.routes';
import productRoute from './routes/product.routes';
import deliveryRoute from './routes/delivery.routes';
import cartRoutes from './routes/cart.routes';
import promoRoutes from './routes/promo.routes';
import orderRoutes from './routes/order.routes';


const app = express();

const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://c-c-delta.vercel.app',
    'https://my-app-phi-pearl-24.vercel.app',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

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
app.use("/api/deliveries", deliveryRoute);
app.use('/api/cart', cartRoutes);
app.use('/api/promos', promoRoutes);
app.use('/api/orders', orderRoutes);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK' });
});

app.listen(ENV.PORT || 5000, () => {
  console.log(`Server running on port ${ENV.PORT || 5000}`);
});