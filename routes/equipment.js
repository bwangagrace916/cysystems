const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Fonction pour générer un code produit automatique
const generateProductCode = async (categoryId = null) => {
  try {
    const prefix = categoryId ? `CAT${String(categoryId).padStart(3, '0')}` : 'PRD';
    const lastProduct = await query(
      'SELECT product_code FROM products WHERE product_code LIKE ? ORDER BY product_code DESC LIMIT 1',
      [`${prefix}%`]
    );
    
    let nextNumber = 1;
    if (lastProduct.length > 0) {
      const lastCode = lastProduct[0].product_code;
      const lastNumber = parseInt(lastCode.replace(prefix, '')) || 0;
      nextNumber = lastNumber + 1;
    }
    
    return `${prefix}${String(nextNumber).padStart(6, '0')}`;
  } catch (error) {
    console.error('Erreur lors de la génération du code produit:', error);
    return `PRD${Date.now()}`;
  }
};

// Fonction pour générer un numéro de lot
const generateLotNumber = async () => {
  try {
    const year = new Date().getFullYear();
    const lastLot = await query(
      'SELECT lot_number FROM purchase_lots WHERE lot_number LIKE ? ORDER BY lot_number DESC LIMIT 1',
      [`LOT${year}%`]
    );
    
    let nextNumber = 1;
    if (lastLot.length > 0) {
      const lastCode = lastLot[0].lot_number;
      const lastNumber = parseInt(lastCode.replace(`LOT${year}`, '')) || 0;
      nextNumber = lastNumber + 1;
    }
    
    return `LOT${year}${String(nextNumber).padStart(4, '0')}`;
  } catch (error) {
    console.error('Erreur lors de la génération du numéro de lot:', error);
    return `LOT${Date.now()}`;
  }
};

// Fonction pour générer un numéro de vente
const generateSaleNumber = async () => {
  try {
    const year = new Date().getFullYear();
    const lastSale = await query(
      'SELECT sale_number FROM sales WHERE sale_number LIKE ? ORDER BY sale_number DESC LIMIT 1',
      [`SALE${year}%`]
    );
    
    let nextNumber = 1;
    if (lastSale.length > 0) {
      const lastCode = lastSale[0].sale_number;
      const lastNumber = parseInt(lastCode.replace(`SALE${year}`, '')) || 0;
      nextNumber = lastNumber + 1;
    }
    
    return `SALE${year}${String(nextNumber).padStart(4, '0')}`;
  } catch (error) {
    console.error('Erreur lors de la génération du numéro de vente:', error);
    return `SALE${Date.now()}`;
  }
};

// ===== CATÉGORIES =====

// GET all categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const categories = await query(`
      SELECT c.*, 
             COUNT(p.id) as product_count,
             parent.name as parent_name
      FROM product_categories c
      LEFT JOIN products p ON c.id = p.category_id
      LEFT JOIN product_categories parent ON c.parent_id = parent.id
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.name
    `);
    res.json(categories);
  } catch (error) {
    console.error('Erreur lors de la récupération des catégories:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des catégories' });
  }
});

// POST create category
router.post('/categories', authenticateToken, authorize('admin', 'manager'), [
  body('name').notEmpty().trim().withMessage('Le nom de la catégorie est requis'),
  body('parent_id').optional().isInt()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, parent_id } = req.body;

    const result = await query(
      'INSERT INTO product_categories (name, description, parent_id) VALUES (?, ?, ?)',
      [name, description || null, parent_id || null]
    );

    res.status(201).json({
      message: 'Catégorie créée avec succès',
      categoryId: result.insertId
    });
  } catch (error) {
    console.error('Erreur lors de la création de la catégorie:', error);
    res.status(500).json({ error: 'Erreur lors de la création de la catégorie' });
  }
});

// ===== FOURNISSEURS =====

// GET all suppliers
router.get('/suppliers', authenticateToken, async (req, res) => {
  try {
    const { search = '', status = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(name LIKE ? OR contact_person LIKE ? OR email LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('status = ?');
      queryParams.push(status);
    }

    const whereClause = whereConditions.join(' AND ');

    const suppliers = await query(`
      SELECT s.*, 
             COUNT(DISTINCT p.id) as product_count,
             COUNT(DISTINCT pl.id) as purchase_count,
             AVG(sr.rating) as avg_rating
      FROM suppliers s
      LEFT JOIN products p ON s.id = p.supplier_id
      LEFT JOIN purchase_lots pl ON s.id = pl.supplier_id
      LEFT JOIN supplier_ratings sr ON s.id = sr.supplier_id
      WHERE ${whereClause}
      GROUP BY s.id
      ORDER BY s.name
    `, queryParams);

    res.json(suppliers);
  } catch (error) {
    console.error('Erreur lors de la récupération des fournisseurs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des fournisseurs' });
  }
});

// POST create supplier
router.post('/suppliers', authenticateToken, authorize('admin', 'manager'), [
  body('name').notEmpty().trim().withMessage('Le nom du fournisseur est requis'),
  body('email').optional().isEmail().withMessage('Email invalide')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      name, contact_person, email, phone, address, city, country,
      tax_number, website, payment_terms, delivery_time_days, notes
    } = req.body;

    const result = await query(
      `INSERT INTO suppliers (name, contact_person, email, phone, address, city, country, 
                             tax_number, website, payment_terms, delivery_time_days, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, contact_person || null, email || null, phone || null, address || null,
       city || null, country || null, tax_number || null, website || null,
       payment_terms || null, delivery_time_days || 7, notes || null]
    );

    res.status(201).json({
      message: 'Fournisseur créé avec succès',
      supplierId: result.insertId
    });
  } catch (error) {
    console.error('Erreur lors de la création du fournisseur:', error);
    res.status(500).json({ error: 'Erreur lors de la création du fournisseur' });
  }
});

// POST rate supplier
router.post('/suppliers/:id/rate', authenticateToken, [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('La note doit être entre 1 et 5'),
  body('criteria').isIn(['quality', 'delivery', 'price', 'service', 'overall']).withMessage('Critère invalide')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { rating, comment, criteria } = req.body;

    await query(
      'INSERT INTO supplier_ratings (supplier_id, user_id, rating, comment, criteria) VALUES (?, ?, ?, ?, ?)',
      [id, req.user.id, rating, comment || null, criteria]
    );

    // Mettre à jour la note moyenne du fournisseur
    const avgRating = await query(`
      SELECT AVG(rating) as avg_rating 
      FROM supplier_ratings 
      WHERE supplier_id = ? AND criteria = 'overall'
    `, [id]);

    if (avgRating[0].avg_rating) {
      await query(
        'UPDATE suppliers SET rating = ? WHERE id = ?',
        [avgRating[0].avg_rating, id]
      );
    }

    res.json({ message: 'Note enregistrée avec succès' });
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement de la note:', error);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement de la note' });
  }
});

// ===== PRODUITS =====

// GET all products
router.get('/products', authenticateToken, async (req, res) => {
  try {
    const { search = '', category_id = '', supplier_id = '', low_stock = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(p.name LIKE ? OR p.product_code LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (category_id) {
      whereConditions.push('p.category_id = ?');
      queryParams.push(category_id);
    }

    if (supplier_id) {
      whereConditions.push('p.supplier_id = ?');
      queryParams.push(supplier_id);
    }

    if (low_stock === 'true') {
      whereConditions.push('p.current_stock <= p.min_stock_level');
    }

    const whereClause = whereConditions.join(' AND ');

    const products = await query(`
      SELECT p.*, 
             c.name as category_name,
             s.name as supplier_name,
             CASE 
               WHEN p.current_stock <= p.min_stock_level THEN 'low'
               WHEN p.current_stock >= p.max_stock_level THEN 'high'
               ELSE 'normal'
             END as stock_status
      FROM products p
      LEFT JOIN product_categories c ON p.category_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE ${whereClause}
      ORDER BY p.name
    `, queryParams);

    res.json(products);
  } catch (error) {
    console.error('Erreur lors de la récupération des produits:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des produits' });
  }
});

// POST create product
router.post('/products', authenticateToken, authorize('admin', 'manager'), [
  body('name').notEmpty().trim().withMessage('Le nom du produit est requis'),
  body('cost_price').isFloat({ min: 0 }).withMessage('Le prix de revient doit être positif'),
  body('selling_price').isFloat({ min: 0 }).withMessage('Le prix de vente doit être positif')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      name, description, category_id, brand, model, sku, barcode,
      unit_type, cost_price, selling_price, min_stock_level, max_stock_level,
      weight, dimensions, color, size, supplier_id
    } = req.body;

    // Générer le code produit automatiquement
    const productCode = await generateProductCode(category_id);

    const result = await query(
      `INSERT INTO products (product_code, name, description, category_id, brand, model, sku, barcode,
                            unit_type, cost_price, selling_price, min_stock_level, max_stock_level,
                            weight, dimensions, color, size, supplier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [productCode, name, description || null, category_id || null, brand || null, model || null,
       sku || null, barcode || null, unit_type || 'piece', cost_price, selling_price,
       min_stock_level || 0, max_stock_level || 1000, weight || null, dimensions || null,
       color || null, size || null, supplier_id || null]
    );

    res.status(201).json({
      message: 'Produit créé avec succès',
      productId: result.insertId,
      productCode: productCode
    });
  } catch (error) {
    console.error('Erreur lors de la création du produit:', error);
    res.status(500).json({ error: 'Erreur lors de la création du produit' });
  }
});

// ===== LOTS D'ACHAT =====

// GET all purchase lots
router.get('/purchase-lots', authenticateToken, async (req, res) => {
  try {
    const { search = '', status = '', supplier_id = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(pl.lot_number LIKE ? OR s.name LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('pl.status = ?');
      queryParams.push(status);
    }

    if (supplier_id) {
      whereConditions.push('pl.supplier_id = ?');
      queryParams.push(supplier_id);
    }

    const whereClause = whereConditions.join(' AND ');

    const lots = await query(`
      SELECT pl.*, 
             s.name as supplier_name,
             COUNT(pli.id) as item_count,
             SUM(pli.quantity_ordered) as total_quantity_ordered,
             SUM(pli.quantity_received) as total_quantity_received
      FROM purchase_lots pl
      JOIN suppliers s ON pl.supplier_id = s.id
      LEFT JOIN purchase_lot_items pli ON pl.id = pli.lot_id
      WHERE ${whereClause}
      GROUP BY pl.id
      ORDER BY pl.created_at DESC
    `, queryParams);

    res.json(lots);
  } catch (error) {
    console.error('Erreur lors de la récupération des lots d\'achat:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des lots d\'achat' });
  }
});

// POST create purchase lot
router.post('/purchase-lots', authenticateToken, authorize('admin', 'manager'), [
  body('supplier_id').isInt().withMessage('Le fournisseur est requis'),
  body('purchase_date').isISO8601().withMessage('La date d\'achat est requise'),
  body('items').isArray().withMessage('Les articles sont requis')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      supplier_id, purchase_date, expected_delivery_date, notes, items
    } = req.body;

    // Générer le numéro de lot
    const lotNumber = await generateLotNumber();

    // Calculer le montant total
    const totalAmount = items.reduce((sum, item) => sum + (item.quantity_ordered * item.unit_cost), 0);

    const result = await query(
      `INSERT INTO purchase_lots (lot_number, supplier_id, purchase_date, expected_delivery_date, 
                                 total_amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [lotNumber, supplier_id, purchase_date, expected_delivery_date || null,
       totalAmount, notes || null, req.user.id]
    );

    const lotId = result.insertId;

    // Ajouter les articles du lot
    for (const item of items) {
      await query(
        `INSERT INTO purchase_lot_items (lot_id, product_id, quantity_ordered, unit_cost, 
                                        total_cost, expiry_date, batch_number, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [lotId, item.product_id, item.quantity_ordered, item.unit_cost,
         item.quantity_ordered * item.unit_cost, item.expiry_date || null,
         item.batch_number || null, item.notes || null]
      );
    }

    res.status(201).json({
      message: 'Lot d\'achat créé avec succès',
      lotId: lotId,
      lotNumber: lotNumber
    });
  } catch (error) {
    console.error('Erreur lors de la création du lot d\'achat:', error);
    res.status(500).json({ error: 'Erreur lors de la création du lot d\'achat' });
  }
});

// ===== POINT DE VENTE =====

// GET all sales
router.get('/sales', authenticateToken, async (req, res) => {
  try {
    const { search = '', status = '', date_from = '', date_to = '' } = req.query;

    let whereConditions = ['1=1'];
    let queryParams = [];

    if (search) {
      whereConditions.push('(s.sale_number LIKE ? OR s.customer_name LIKE ? OR s.customer_email LIKE ?)');
      queryParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('s.status = ?');
      queryParams.push(status);
    }

    if (date_from) {
      whereConditions.push('DATE(s.created_at) >= ?');
      queryParams.push(date_from);
    }

    if (date_to) {
      whereConditions.push('DATE(s.created_at) <= ?');
      queryParams.push(date_to);
    }

    const whereClause = whereConditions.join(' AND ');

    const sales = await query(`
      SELECT s.*, 
             u.first_name as created_by_first_name,
             u.last_name as created_by_last_name,
             COUNT(si.id) as item_count
      FROM sales s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN sale_items si ON s.id = si.sale_id
      WHERE ${whereClause}
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `, queryParams);

    res.json(sales);
  } catch (error) {
    console.error('Erreur lors de la récupération des ventes:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des ventes' });
  }
});

// POST create sale
router.post('/sales', authenticateToken, [
  body('items').isArray().withMessage('Les articles sont requis'),
  body('payment_method').isIn(['cash', 'card', 'check', 'transfer', 'other']).withMessage('Méthode de paiement invalide')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      customer_name, customer_email, customer_phone, items, subtotal, tax_rate,
      tax_amount, discount_amount, total_amount, payment_method, payment_reference, notes
    } = req.body;

    // Générer le numéro de vente
    const saleNumber = await generateSaleNumber();

    const result = await query(
      `INSERT INTO sales (sale_number, customer_name, customer_email, customer_phone,
                         subtotal, tax_rate, tax_amount, discount_amount, total_amount,
                         payment_method, payment_reference, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [saleNumber, customer_name || null, customer_email || null, customer_phone || null,
       subtotal, tax_rate || 0, tax_amount || 0, discount_amount || 0, total_amount,
       payment_method, payment_reference || null, notes || null, req.user.id]
    );

    const saleId = result.insertId;

    // Ajouter les articles de vente
    for (const item of items) {
      await query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, 
                                discount_percent, discount_amount, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [saleId, item.product_id, item.quantity, item.unit_price,
         item.discount_percent || 0, item.discount_amount || 0, item.total_price]
      );

      // Mettre à jour le stock
      await query(
        'UPDATE products SET current_stock = current_stock - ? WHERE id = ?',
        [item.quantity, item.product_id]
      );

      // Enregistrer le mouvement de stock
      await query(
        `INSERT INTO stock_movements (product_id, movement_type, quantity, unit_cost, 
                                     total_cost, reference_type, reference_id, created_by)
         VALUES (?, 'out', ?, ?, ?, 'sale', ?, ?)`,
        [item.product_id, item.quantity, item.unit_price, item.total_price, saleId, req.user.id]
      );
    }

    res.status(201).json({
      message: 'Vente enregistrée avec succès',
      saleId: saleId,
      saleNumber: saleNumber
    });
  } catch (error) {
    console.error('Erreur lors de l\'enregistrement de la vente:', error);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement de la vente' });
  }
});

// ===== STATISTIQUES =====

// GET equipment statistics
router.get('/stats/overview', authenticateToken, authorize('admin', 'manager'), async (req, res) => {
  try {
    const stats = await query(`
      SELECT
        (SELECT COUNT(*) FROM products WHERE is_active = 1) as total_products,
        (SELECT COUNT(*) FROM products WHERE current_stock <= min_stock_level AND is_active = 1) as low_stock_products,
        (SELECT COUNT(*) FROM suppliers WHERE status = 'active') as active_suppliers,
        (SELECT COUNT(*) FROM purchase_lots WHERE status = 'pending') as pending_orders,
        (SELECT SUM(current_stock * cost_price) FROM products WHERE is_active = 1) as total_inventory_value,
        (SELECT SUM(total_amount) FROM sales WHERE status = 'completed' AND DATE(created_at) = CURDATE()) as today_sales,
        (SELECT SUM(total_amount) FROM sales WHERE status = 'completed' AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())) as month_sales
    `);

    const topProducts = await query(`
      SELECT p.name, p.product_code, SUM(si.quantity) as total_sold, SUM(si.total_price) as total_revenue
      FROM products p
      JOIN sale_items si ON p.id = si.product_id
      JOIN sales s ON si.sale_id = s.id
      WHERE s.status = 'completed' AND s.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY p.id, p.name, p.product_code
      ORDER BY total_sold DESC
      LIMIT 10
    `);

    const lowStockProducts = await query(`
      SELECT name, product_code, current_stock, min_stock_level
      FROM products
      WHERE current_stock <= min_stock_level AND is_active = 1
      ORDER BY (current_stock - min_stock_level) ASC
      LIMIT 10
    `);

    res.json({
      overview: stats[0],
      topProducts: topProducts,
      lowStockProducts: lowStockProducts
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
});

module.exports = router;