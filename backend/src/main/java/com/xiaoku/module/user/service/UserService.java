package com.xiaoku.module.user.service;

import com.xiaoku.module.user.dto.UserLoginDTO;
import com.xiaoku.module.user.dto.UserProfileUpdateDTO;
import com.xiaoku.module.user.dto.UserRegisterDTO;
import com.xiaoku.module.user.vo.LoginVO;
import com.xiaoku.module.user.vo.UserVO;

public interface UserService {

    /**
     * 注册。用户名重复时抛业务异常（由唯一索引 uk_username 兜底）。
     */
    UserVO register(UserRegisterDTO dto);

    /**
     * 登录，签发 token。
     */
    LoginVO login(UserLoginDTO dto);

    /**
     * 用 refresh token 换新的 access token。
     */
    LoginVO refresh(String refreshToken);

    /**
     * 查当前登录用户信息（走缓存）。
     */
    UserVO getCurrentUserVO();

    /**
     * 按 id 查用户信息（走缓存），用户不存在返回 null。
     */
    UserVO getUserVO(Long userId);

    /**
     * 修改当前登录用户的资料。
     */
    UserVO updateProfile(UserProfileUpdateDTO dto);
}
