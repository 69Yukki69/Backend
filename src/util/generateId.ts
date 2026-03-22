import prisma from '../config/db';

export type ModelName =
  | 'employee'
  | 'customer'
  | 'supplier'
  | 'product'
  | 'saleRecord'
  | 'orderLine'
  | 'payment'
  | 'shoppingCart'
  | 'shoppingCartItem'
  | 'promotionSale'
  | 'inventoryLog'
  | 'delivery'
  | 'deliveryItem';

const prefixMap: Record<ModelName, string> = {
  employee:         'EMP',
  customer:         'CUS',
  supplier:         'SUP',
  product:          'PRD',
  saleRecord:       'SAL',
  orderLine:        'ORL',
  payment:          'PAY',
  shoppingCart:     'CRT',
  shoppingCartItem: 'ITM',
  promotionSale:    'PRO',
  inventoryLog:     'LOG',
  delivery:         'DEL',
  deliveryItem:     'DLI',
};

const getLastRecord = async (model: ModelName) => {
  switch (model) {
    case 'employee':
      return prisma.employee.findFirst({ orderBy: { id: 'desc' } });
    case 'customer':
      return prisma.customer.findFirst({ orderBy: { id: 'desc' } });
    case 'supplier':
      return prisma.supplier.findFirst({ orderBy: { id: 'desc' } });
    case 'product':
      return prisma.product.findFirst({ orderBy: { id: 'desc' } });
    case 'saleRecord':
      return prisma.saleRecord.findFirst({ orderBy: { id: 'desc' } });
    case 'orderLine':
      return prisma.orderLine.findFirst({ orderBy: { id: 'desc' } });
    case 'payment':
      return prisma.payment.findFirst({ orderBy: { id: 'desc' } });
    case 'shoppingCart':
      return prisma.shoppingCart.findFirst({ orderBy: { id: 'desc' } });
    case 'shoppingCartItem':
      return prisma.shoppingCartItem.findFirst({ orderBy: { id: 'desc' } });
    case 'promotionSale':
      return prisma.promotionSale.findFirst({ orderBy: { id: 'desc' } });
    case 'inventoryLog':
      return prisma.inventoryLog.findFirst({ orderBy: { id: 'desc' } });
    case 'delivery':
      return prisma.delivery.findFirst({ orderBy: { id: 'desc' } });
    case 'deliveryItem':
      return prisma.deliveryItem.findFirst({ orderBy: { id: 'desc' } });
    default:
      return null;
  }
};

export const generateId = async (model: ModelName): Promise<string> => {
  const prefix = prefixMap[model];
  const last = await getLastRecord(model);

  if (!last) return `${prefix}-1000`;

  const lastNumber = parseInt(last.id.split('-')[1]);
  return `${prefix}-${lastNumber + 1}`;
};