import express from 'express';
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
    'https://my-app-phi-pearl-24.vercel.app',
  ],
  credentials: true
}));
app.use(express.json());

app.use('/api/employees', employeeRoute);
app.use('/api/suppliers', supplierRoute);
app.use('/api/customers', customerRoute);
app.use('/api/products', productRoute);

app.listen(ENV.PORT || 5000, () => {
  console.log(`Server running on port ${ENV.PORT || 5000}`);
});