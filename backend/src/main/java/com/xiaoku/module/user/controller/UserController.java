package com.xiaoku.module.user.controller;

import com.xiaoku.common.context.UserContextHolder;
import com.xiaoku.common.result.Result;
import com.xiaoku.common.util.JwtUtil;
import com.xiaoku.module.user.dto.UserLoginDTO;
import com.xiaoku.module.user.dto.UserProfileUpdateDTO;
import com.xiaoku.module.user.dto.UserRegisterDTO;
import com.xiaoku.module.user.service.UserService;
import com.xiaoku.module.user.vo.LoginVO;
import com.xiaoku.module.user.vo.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * 用户模块接口。
 */
@Tag(name = "01-用户模块", description = "注册、登录、刷新令牌、个人资料")
@RestController
@RequestMapping("/api/user")
@RequiredArgsConstructor
public class UserController {

    private final UserService userService;
    private final JwtUtil jwtUtil;

    @Operation(summary = "注册", description = "用户名唯一，注册成功后直接返回用户信息，不自动登录")
    @PostMapping("/register")
    public Result<UserVO> register(@RequestBody @Valid UserRegisterDTO dto) {
        return Result.success(userService.register(dto));
    }

    @Operation(summary = "登录", description = "返回 accessToken(2h) 与 refreshToken(30d)")
    @PostMapping("/login")
    public Result<LoginVO> login(@RequestBody @Valid UserLoginDTO dto) {
        return Result.success(userService.login(dto));
    }

    @Operation(summary = "刷新令牌", description = "用 refreshToken 换新的 accessToken")
    @PostMapping("/refresh")
    public Result<LoginVO> refresh(
            @Parameter(description = "refreshToken") @NotBlank @RequestParam String refreshToken) {
        String token = jwtUtil.resolveToken(refreshToken);
        return Result.success(userService.refresh(token));
    }

    @Operation(summary = "获取当前登录用户", description = "需要 Authorization 请求头，走 Redis 缓存")
    @GetMapping("/me")
    public Result<UserVO> me() {
        return Result.success(userService.getCurrentUserVO());
    }

    @Operation(summary = "修改个人资料", description = "部分更新：只提交要改的字段即可")
    @PutMapping("/profile")
    public Result<UserVO> updateProfile(@RequestBody @Valid UserProfileUpdateDTO dto) {
        return Result.success(userService.updateProfile(dto));
    }

    @Operation(summary = "当前登录用户ID", description = "调试用：验证 ThreadLocal 上下文是否正确注入")
    @GetMapping("/me/context")
    public Result<Object> currentContext() {
        return Result.success(UserContextHolder.requireLogin());
    }
}
