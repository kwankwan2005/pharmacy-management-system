// This controller handles the entire new order and validation workflow.

const db = require("../config/db");
const { get } = require("../routes/orderRoutes");

/**
 * @desc    Customer places an initial order from their cart
 * @route   POST /api/orders
 * @access  Private (Customer)
 */
const placeInitialOrder = async (req, res) => {
  const customerId = req.user.id;
  const { items, branchId, fulfillment } = req.body;

  if (!items || items.length === 0) {
    return res
      .status(400)
      .json({ message: "Order must contain at least one item." });
  }
  if (!branchId) {
    return res.status(400).json({ message: "Branch ID is required." });
  }
  if (
    !fulfillment ||
    !["home_delivery", "in_store_pickup"].includes(fulfillment.method)
  ) {
    return res
      .status(400)
      .json({ message: "A valid fulfillment method is required." });
  }
  if (fulfillment.method === "home_delivery" && !fulfillment.address) {
    return res
      .status(400)
      .json({ message: "Address is required for home delivery." });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    for (const item of items) {
      const [inventoryCheck] = await connection.query(
        "SELECT quantity FROM inventory WHERE product_id = ? AND branch_id = ? FOR UPDATE",
        [item.productId, branchId]
      );

      if (
        inventoryCheck.length === 0 ||
        inventoryCheck[0].quantity < item.quantity
      ) {
        throw new Error(
          `Insufficient stock for product ID ${item.productId}. Available: ${
            inventoryCheck[0]?.quantity || 0
          }, Required: ${item.quantity}`
        );
      }

      await connection.query(
        "UPDATE inventory SET quantity = quantity - ? WHERE product_id = ? AND branch_id = ?",
        [item.quantity, item.productId, branchId]
      );
    }

    const productIds = items.map((item) => item.productId);
    const [products] = await connection.query(
      "SELECT product_id, price, requires_prescription FROM product WHERE product_id IN (?)",
      [productIds]
    );

    const requiresPrescription = products.some((p) => p.requires_prescription);
    const initialStatus = requiresPrescription
      ? "pending_prescription"
      : "pending_payment";

    let totalAmount = 0;
    const productMap = new Map(products.map((p) => [p.product_id, p]));
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product)
        throw new Error(`Product with ID ${item.productId} not found.`);
      totalAmount += product.price * item.quantity;
    }

    const [orderResult] = await connection.query(
      "INSERT INTO `order` (customer_id, branch_id, status, total_amount) VALUES (?, ?, ?, ?)",
      [customerId, branchId, initialStatus, totalAmount]
    );
    const orderId = orderResult.insertId;

    const orderItemsData = items.map((item) => {
      const product = productMap.get(item.productId);
      return [orderId, item.productId, item.quantity, product.price];
    });

    await connection.query(
      "INSERT INTO order_item (order_id, product_id, quantity, price_per_unit) VALUES ?",
      [orderItemsData]
    );

    await connection.query(
      `INSERT INTO delivery (order_id, delivery_method, address, status) VALUES (?, ?, ?, 'pending')`,
      [orderId, fulfillment.method, fulfillment.address || null]
    );

    await connection.commit();

    res.status(201).json({
      message: "Order placed successfully.",
      orderId,
      status: initialStatus,
    });
  } catch (error) {
    await connection.rollback();
    console.error("--- ERROR PLACING ORDER ---", error);
    res
      .status(500)
      .json({
        message: error.message || "Server error during order placement.",
      });
  } finally {
    connection.release();
  }
};

const getOrderById = async (req, res) => {
  const { id: orderId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    let query = `
            SELECT o.order_id, o.customer_id, o.order_date, o.total_amount, o.status,
                   c.first_name, c.last_name, c.email
            FROM \`order\` o
            JOIN customer c ON o.customer_id = c.customer_id
            WHERE o.order_id = ?
        `;

    const queryParams = [orderId];
    if (userRole === "customer") {
      query += " AND o.customer_id = ?";
      queryParams.push(userId);
    }

    const [orders] = await db.query(query, queryParams);

    if (orders.length === 0) {
      return res.status(404).json({ message: "Order not found." });
    }

    const [items] = await db.query(
      `
            SELECT oi.product_id, oi.quantity, oi.price_per_unit,
                   p.name as product_name, p.description
            FROM order_item oi
            JOIN product p ON oi.product_id = p.product_id
            WHERE oi.order_id = ?
            `,
      [orderId]
    );

    const [delivery] = await db.query(
      "SELECT * FROM delivery WHERE order_id = ?",
      [orderId]
    );

    const orderData = {
      ...orders[0],
      items: items,
      delivery: delivery.length > 0 ? delivery[0] : null,
    };

    res.status(200).json(orderData);
  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({ message: "Server error while fetching order." });
  }
};

module.exports = {
  placeInitialOrder,
  getOrderById,
};
