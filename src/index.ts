import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { ENV } from './config/env';
import employeeRoute    from './routes/employee.routes';
import supplierRoute    from './routes/supplier.route';
import customerRoute    from './routes/customer.routes';
import productRoute     from './routes/product.routes';
import deliveryRoute    from './routes/delivery.routes';
import cartRoutes       from './routes/cart.routes';
import promoRoutes      from './routes/promo.routes';
import orderRoutes      from './routes/order.routes';
import inventoryRoutes  from './routes/inventory.routes';
import uploadRoutes     from './routes/upload.routes';
import returnRoutes     from './routes/return.routes';
import lossReportRoutes from './routes/loss.routes';

const app = express();
const httpServer = createServer(app); // ← wrap express with http server

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

// Socket.io (same CORS origins as Express)
export const io = new Server(httpServer, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join', (userId: string) => {
    socket.join(`user:${userId}`);
    console.log(`User ${userId} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use('/api/employees',   employeeRoute);
app.use('/api/suppliers',   supplierRoute);
app.use('/api/customers',   customerRoute);
app.use('/api/products',    productRoute);
app.use('/api/deliveries',  deliveryRoute);
app.use('/api/cart',        cartRoutes);
app.use('/api/promos',      promoRoutes);
app.use('/api/orders',      orderRoutes);
app.use('/api/inventory',   inventoryRoutes);
app.use('/api/upload',      uploadRoutes);
app.use('/api/returns',     returnRoutes);
app.use('/api/loss-reports', lossReportRoutes);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK' });
});

// ← httpServer instead of app.listen
httpServer.listen(ENV.PORT || 5000, () => {
  console.log(`Server running on port ${ENV.PORT || 5000}`);
});