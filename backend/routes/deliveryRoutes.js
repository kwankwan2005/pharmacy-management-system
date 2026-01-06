const express = require("express");
const router = express.Router();
const {
  getFulfillmentQueue,
  updateDeliveryStatus,
} = require("../controllers/deliveryController");
const { protect } = require("../middleware/authMiddleware");

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: `Forbidden.` });
    }
    next();
  };
};

// @route   GET /api/delivery/queue
// @desc    Get the fulfillment queue for warehouse personnel
// @access  Private (WarehousePersonnel)
router.get(
  "/queue",
  protect,
  authorize("warehousePersonnel"),
  getFulfillmentQueue
);

// @route   PUT /api/delivery/:orderId/status
// @desc    Update the delivery status of an order
// @access  Private (WarehousePersonnel)
router.put(
  "/:orderId/status",
  protect,
  authorize("warehousePersonnel"),
  updateDeliveryStatus
);

module.exports = router;
