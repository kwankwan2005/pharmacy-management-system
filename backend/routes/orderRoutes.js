const express = require("express");
const router = express.Router();

const {
  placeInitialOrder,
  getOrderById,
} = require("../controllers/orderController");
const { protect } = require("../middleware/authMiddleware");

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({
          message: `Forbidden: This route is only for ${roles.join(" or ")}.`,
        });
    }
    next();
  };
};

// @route   POST /api/orders
// @desc    Place an initial order
// @access  Private (Customer)
router.post("/", protect, authorize("customer"), placeInitialOrder);

// @route   GET /api/orders/:id
// @desc    Get order details by ID
// @access  Private (Customer, Pharmacist, Cashier, WarehousePersonnel)
router.get(
  "/:id",
  protect,
  authorize("customer", "pharmacist", "cashier", "warehousePersonnel"),
  getOrderById
);

module.exports = router;
