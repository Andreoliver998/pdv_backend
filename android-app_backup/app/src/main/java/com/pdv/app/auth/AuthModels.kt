package com.pdv.app.auth

// Corpo que vamos enviar no POST /api/auth/login
data class LoginRequest(
    val email: String,
    val password: String
)

// Usuário retornado pelo backend
data class UserDto(
    val id: Int,
    val name: String,
    val email: String,
    val role: String,
    val merchantId: Int
)

// Merchant retornado pelo backend
data class MerchantDto(
    val id: Int,
    val name: String,
    val cnpj: String?,
    val createdAt: String
)

// Resposta completa do login
data class LoginResponse(
    val token: String,
    val user: UserDto,
    val merchant: MerchantDto
)
