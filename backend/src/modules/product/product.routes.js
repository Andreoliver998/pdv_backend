// backend/src/modules/product/product.routes.js
const { Router } = require('express');
const { ensureAuth } = require('../../middlewares/auth');

const {
  list,
  create,
  bulkCreate,
  update,
  archive,
} = require('./product.controller');

const router = Router();

router.use(ensureAuth);

router.get('/', list);
router.post('/', create);
router.post('/bulk', bulkCreate);

// compatível com PATCH e PUT
router.patch('/:id', update);
router.put('/:id', update);

// ✅ Arquivar produto (active=false)
router.post('/:id/archive', archive);

module.exports = router;
